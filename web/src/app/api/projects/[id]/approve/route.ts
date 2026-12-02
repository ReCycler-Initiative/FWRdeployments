import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiResponse, ApiError, callWorker, jsonBody, projectId, requireSameOrigin, type ProjectRoute } from "@/lib/api";
import { getWorkspace, transaction } from "@/lib/db";
import { projectMedia } from "@/lib/media";
import { implementationPlan, implementationPrompt } from "@/lib/prompts";
import { deliveryModeSchema, generationModeSchema, uuid, type GenerationMode } from "@/lib/types";
import { isWrittenOutput, writtenOutputs } from "@/lib/deliveries";

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const input = await jsonBody(request, z.object({
      candidate_id: uuid, delivery_mode: deliveryModeSchema.exclude(["AGENTS"]),
      refinement: z.string().trim().max(5000).default(""),
      expected_delivery_id: uuid.nullable().optional(),
    }));
    const workspace = await getWorkspace(id);
    if (!workspace) throw new ApiError(404, "Projektia ei löytynyt.");
    const candidate = workspace.candidates.find((candidate) => candidate.id === input.candidate_id);
    if (!candidate) throw new ApiError(404, "Kandidaatti ei kuulu projektiin.");
    const deliveryId = randomUUID();
    const folder = path.join(projectMedia(id), "artifacts", "delivery", deliveryId);
    const written: string[] = [];
    try {
      await transaction(async (client) => {
        const result = await client.query(
          `SELECT status, delivery_mode, active_delivery_id,
           (SELECT id FROM solution_candidates WHERE project_id=$1 AND is_selected) AS selected_candidate_id
           FROM projects WHERE id=$1 FOR UPDATE`, [id],
        );
        const current = result.rows[0];
        if (!current) throw new ApiError(404, "Projektia ei löytynyt.");
        if (current.status === "READY_FOR_REVIEW" && current.delivery_mode === input.delivery_mode
          && current.selected_candidate_id === candidate.id) return;
        if (!["CANDIDATES_READY", "READY_FOR_REVIEW"].includes(current.status)) {
          throw new ApiError(409, "Valintaa voi muuttaa vain valmiiden ratkaisujen tai valmiin toimituksen vaiheessa.");
        }
        if (current.selected_candidate_id && (input.expected_delivery_id === undefined
          || input.expected_delivery_id !== current.active_delivery_id)) {
          throw new ApiError(409, "Valinta on muuttunut tai vahvistus puuttuu. Päivitä työtila ja vahvista muutos uudelleen.");
        }
        const stillExists = await client.query("SELECT id FROM solution_candidates WHERE id=$1 AND project_id=$2 AND NOT is_superseded", [candidate.id, id]);
        if (!stillExists.rows.length) throw new ApiError(409, "Kandidaatit ovat päivittyneet. Lataa työtila uudelleen.");
        const approved = { ...candidate, is_selected: true };
        let outputMode: GenerationMode | null = null;
        const files = isWrittenOutput(input.delivery_mode) ? []
          : input.delivery_mode === "PLAN"
          ? [{ name: "implementation-plan.md", content: implementationPlan(workspace, approved, input.refinement) }]
          : [
              { name: "implementation-prompt.md", content: implementationPrompt(workspace, approved, input.refinement) },
            ];
        if (isWrittenOutput(input.delivery_mode)) {
          const response = await callWorker(id, "generate-output", {
            candidate_id: candidate.id, output_type: input.delivery_mode, refinement: input.refinement,
          });
          const output = z.object({
            content: z.string().min(20).max(250000), generation_mode: generationModeSchema,
            external_research: z.literal(false), source_ids: z.array(z.string()),
          }).parse(await response.json());
          outputMode = output.generation_mode;
          files.push(
            { name: writtenOutputs[input.delivery_mode].filename, content: output.content },
            { name: "output-provenance.json", content: JSON.stringify({
              output_type: input.delivery_mode, candidate_id: candidate.id,
              generation_mode: outputMode, external_research: false, source_ids: output.source_ids,
            }, null, 2) },
          );
        }
        await mkdir(folder, { recursive: true });
        for (const file of files) {
          const filename = path.join(folder, file.name);
          await writeFile(filename, file.content, { encoding: "utf-8", flag: "wx" });
          written.push(filename);
        }
        await client.query("UPDATE solution_candidates SET is_selected=false WHERE project_id=$1", [id]);
        await client.query("UPDATE solution_candidates SET is_selected=true WHERE id=$1", [candidate.id]);
        await client.query(
          "UPDATE projects SET status='READY_FOR_REVIEW', delivery_mode=$2, active_delivery_id=$3, delivery_generation_mode=$4 WHERE id=$1",
          [id, input.delivery_mode, deliveryId, outputMode],
        );
      });
    } catch (error) {
      await Promise.all(written.map((filename) => unlink(filename)));
      throw error;
    }
    return Response.json({ status: "ready", delivery_mode: input.delivery_mode });
  });
}

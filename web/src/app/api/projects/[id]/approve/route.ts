import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiResponse, ApiError, jsonBody, projectId, requireSameOrigin, type ProjectRoute } from "@/lib/api";
import { getWorkspace, transaction } from "@/lib/db";
import { projectMedia } from "@/lib/media";
import { implementationPlan, implementationPrompt } from "@/lib/prompts";
import { uuid } from "@/lib/types";

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const input = await jsonBody(request, z.object({
      candidate_id: uuid, delivery_mode: z.enum(["PROMPTS", "PLAN"]),
      refinement: z.string().trim().max(5000).default(""),
    }));
    const workspace = await getWorkspace(id);
    if (!workspace) throw new ApiError(404, "Projektia ei löytynyt.");
    const candidate = workspace.candidates.find((candidate) => candidate.id === input.candidate_id);
    if (!candidate) throw new ApiError(404, "Kandidaatti ei kuulu projektiin.");
    const folder = path.join(projectMedia(id), "artifacts", "delivery", randomUUID());
    const written: string[] = [];
    try {
      await transaction(async (client) => {
        const result = await client.query("SELECT status, delivery_mode FROM projects WHERE id=$1 FOR UPDATE", [id]);
        const current = result.rows[0];
        if (!current) throw new ApiError(404, "Projektia ei löytynyt.");
        if (current.status === "READY_FOR_REVIEW" && current.delivery_mode === input.delivery_mode && candidate.is_selected) return;
        if (current.status !== "CANDIDATES_READY") throw new ApiError(409, "Hyväksyntä vaatii valmiit ratkaisukandidaatit.");
        const stillExists = await client.query("SELECT id FROM solution_candidates WHERE id=$1 AND project_id=$2", [candidate.id, id]);
        if (!stillExists.rows.length) throw new ApiError(409, "Kandidaatit ovat päivittyneet. Lataa työtila uudelleen.");
        const approved = { ...candidate, is_selected: true };
        const files = input.delivery_mode === "PLAN"
          ? [{ name: "implementation-plan.md", content: implementationPlan(workspace, approved, input.refinement) }]
          : [
              { name: "copilot-prompt.md", content: implementationPrompt(workspace, approved, "copilot", input.refinement) },
              { name: "claude-prompt.md", content: implementationPrompt(workspace, approved, "claude", input.refinement) },
            ];
        await mkdir(folder, { recursive: true });
        for (const file of files) {
          const filename = path.join(folder, file.name);
          await writeFile(filename, file.content, { encoding: "utf-8", flag: "wx" });
          written.push(filename);
        }
        await client.query("UPDATE solution_candidates SET is_selected=false WHERE project_id=$1", [id]);
        await client.query("UPDATE solution_candidates SET is_selected=true WHERE id=$1", [candidate.id]);
        await client.query("UPDATE projects SET status='READY_FOR_REVIEW', delivery_mode=$2 WHERE id=$1", [id, input.delivery_mode]);
      });
    } catch (error) {
      await Promise.all(written.map((filename) => unlink(filename)));
      throw error;
    }
    return Response.json({ status: "ready", delivery_mode: input.delivery_mode });
  });
}

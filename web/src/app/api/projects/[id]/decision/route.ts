import { z } from "zod";
import { apiResponse, ApiError, jsonBody, projectId, requireSameOrigin, type ProjectRoute } from "@/lib/api";
import { activeIteration, transaction } from "@/lib/db";
import { iterationSchema, uuid } from "@/lib/types";

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const input = await jsonBody(request, z.object({
      candidate_id: uuid,
      expected_iteration_id: uuid,
      decision_rationale: z.string().trim().min(1).max(5000),
      hypothesis: z.string().trim().min(1).max(5000),
    }));
    const decision = await transaction(async (client) => {
      const project = (await client.query("SELECT status FROM projects WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!project) throw new ApiError(404, "Projektia ei löytynyt.");
      if (!["CANDIDATES_READY", "READY_FOR_REVIEW"].includes(project.status)) {
        throw new ApiError(409, "Päätös edellyttää valmiita ja ajantasaisia ratkaisuehdotuksia.");
      }
      const iteration = await activeIteration(client, id);
      if (!iteration || iteration.id !== input.expected_iteration_id) {
        throw new ApiError(409, "Päätöskierros on muuttunut. Päivitä työtila ja tarkista valinta.");
      }
      if (iteration.decided_at) throw new ApiError(409, "Kierroksen päätös on vahvistettu. Katselmoi tuotos ja päätä kierros ennen uutta päätöstä.");
      const candidate = (await client.query(
        "SELECT id FROM solution_candidates WHERE id=$1 AND project_id=$2 AND iteration_id=$3 AND NOT is_superseded",
        [input.candidate_id, id, iteration.id],
      )).rows[0];
      if (!candidate) throw new ApiError(409, "Valitse tämän kierroksen ajantasainen ratkaisuehdotus.");
      const updated = await client.query(
        `UPDATE ooda_iterations SET status='ACT',selected_solution_id=$2,decision_rationale=$3,
         hypothesis=$4,decided_at=now() WHERE id=$1 RETURNING *`,
        [iteration.id, candidate.id, input.decision_rationale, input.hypothesis],
      );
      await client.query("UPDATE solution_candidates SET is_selected=(id=$2) WHERE project_id=$1", [id, candidate.id]);
      await client.query(
        `UPDATE projects SET status='CANDIDATES_READY',active_delivery_id=NULL,
         delivery_mode=NULL,delivery_generation_mode=NULL WHERE id=$1`, [id],
      );
      return iterationSchema.parse(updated.rows[0]);
    });
    return Response.json(decision, { status: 201 });
  });
}

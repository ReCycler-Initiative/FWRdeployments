import { z } from "zod";
import { apiResponse, ApiError, jsonBody, projectId, requireSameOrigin, type ProjectRoute } from "@/lib/api";
import { transaction } from "@/lib/db";
import { candidateSchema, uuid } from "@/lib/types";

export async function PATCH(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const input = await jsonBody(request, z.object({
      candidate_id: uuid,
      implementation_status: z.enum(["NOT_STARTED", "IN_PROGRESS", "BLOCKED", "IN_REVIEW", "COMPLETED"]),
      implementation_notes: z.string().trim().max(10000),
      implementation_url: z.string().max(1000).refine((value) => {
        if (!value) return true;
        try {
          const url = new URL(value);
          return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password;
        } catch { return false; }
      }, "Anna GitHubin HTTPS-osoite ilman tunnuksia."),
    }));
    const candidate = await transaction(async (client) => {
      const project = await client.query("SELECT status FROM projects WHERE id=$1 FOR UPDATE", [id]);
      if (!project.rows[0]) throw new ApiError(404, "Projektia ei löytynyt.");
      if (project.rows[0].status === "BUILDING") throw new ApiError(409, "Agenttiketju päivittää tilaa automaattisesti. Odota sen valmistumista.");
      const result = await client.query(
        `UPDATE solution_candidates SET implementation_status=$3, implementation_notes=$4,
         implementation_url=$5, implementation_updated_at=now()
         WHERE id=$1 AND project_id=$2 AND is_selected RETURNING *`,
        [input.candidate_id, id, input.implementation_status, input.implementation_notes, input.implementation_url || null],
      );
      if (!result.rows[0]) throw new ApiError(409, "Vain projektiin valitun ratkaisun toteutustilaa voi päivittää.");
      return candidateSchema.parse(result.rows[0]);
    });
    return Response.json(candidate);
  });
}

import { z } from "zod";
import {
  apiResponse, ApiError, callWorker, jsonBody, projectId, requireSameOrigin, type ProjectRoute,
} from "@/lib/api";
import { ensureOpenIteration, requireEvidenceEditing, transaction } from "@/lib/db";
import { uuid } from "@/lib/types";

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const input = await jsonBody(request, z.object({ session_id: uuid }));
    await transaction(async (client) => {
      await client.query("SELECT id FROM projects WHERE id=$1 FOR UPDATE", [id]);
      const session = await client.query("SELECT id FROM sessions WHERE id=$1 AND project_id=$2", [input.session_id, id]);
      if (!session.rows.length) throw new ApiError(404, "Työpaja ei kuulu projektiin.");
      await requireEvidenceEditing(client, id);
      await ensureOpenIteration(client, id);
    });
    const response = await callWorker(id, "analyze", input);
    return Response.json(await response.json(), { status: 202 });
  });
}

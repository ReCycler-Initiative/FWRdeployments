import { rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { apiResponse, ApiError, jsonBody, projectId, requireSameOrigin, type ProjectRoute } from "@/lib/api";
import { getWorkspace, transaction } from "@/lib/db";
import { listArtifacts, projectMedia } from "@/lib/media";
import { getAiCapabilities } from "@/lib/ai-capabilities";

export async function GET(_request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    const id = await projectId(context);
    const workspace = await getWorkspace(id);
    if (!workspace) throw new ApiError(404, "Projektia ei löytynyt.");
    const [artifacts, ai] = await Promise.all([listArtifacts(id), getAiCapabilities()]);
    return Response.json({ ...workspace, artifacts, ai }, {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

export async function DELETE(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    await jsonBody(request, z.object({
      confirmed: z.literal(true, { error: "Projektin poisto on vahvistettava." }),
    }));
    await transaction(async (client) => {
      const project = await client.query("SELECT status, active_delivery_id FROM projects WHERE id=$1 FOR UPDATE", [id]);
      if (!project.rows[0]) throw new ApiError(404, "Projektia ei löytynyt.");
      const activity = await client.query(
        `SELECT EXISTS (SELECT 1 FROM sessions WHERE project_id=$1 AND pain_points_json->>'status'='running')
          OR EXISTS (SELECT 1 FROM agent_tasks WHERE project_id=$1 AND status IN ('pending','running')) AS active,
          EXISTS (SELECT 1 FROM agent_tasks WHERE project_id=$1 AND status='failed'
            AND delivery_id IS NOT DISTINCT FROM $2::uuid) AS failed`,
        [id, project.rows[0].active_delivery_id],
      );
      if (activity.rows[0].active || (project.rows[0].status === "BUILDING" && !activity.rows[0].failed)) {
        throw new ApiError(409, "Projektia ei voi poistaa analyysin tai agenttityön aikana. Odota työn valmistumista.");
      }
      await client.query("DELETE FROM projects WHERE id=$1", [id]);
      // File errors roll back the database deletion, allowing an explicit retry.
      await rm(path.resolve(projectMedia(id)), { recursive: true, force: true });
    });
    return Response.json({ deleted: true });
  });
}

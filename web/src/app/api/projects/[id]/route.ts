import { apiResponse, ApiError, projectId, type ProjectRoute } from "@/lib/api";
import { getWorkspace } from "@/lib/db";
import { listArtifacts } from "@/lib/media";

export async function GET(_request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    const id = await projectId(context);
    const workspace = await getWorkspace(id);
    if (!workspace) throw new ApiError(404, "Projektia ei löytynyt.");
    return Response.json({ ...workspace, artifacts: await listArtifacts(id) }, {
      headers: { "Cache-Control": "no-store" },
    });
  });
}

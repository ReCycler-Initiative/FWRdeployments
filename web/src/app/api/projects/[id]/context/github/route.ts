import { apiResponse, ApiError, jsonBody, projectId, requireSameOrigin, type ProjectRoute } from "@/lib/api";
import { getProject } from "@/lib/db";
import { saveContext } from "@/lib/context";
import { githubInput, importGithub } from "@/lib/github-context";

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const project = await getProject(id);
    if (!project) throw new ApiError(404, "Projektia ei löytynyt.");
    if (!["PREPARATION", "CANDIDATES_READY"].includes(project.status)) throw new ApiError(409, "Lähteiden tuonti on lukittu käsittelyn ajaksi.");
    const input = await jsonBody(request, githubInput);
    const document = await saveContext(id, await importGithub(input));
    return Response.json(document, { status: 201 });
  });
}

import { apiResponse, ApiError, projectId } from "@/lib/api";
import { getWorkspace } from "@/lib/db";
import { uuid } from "@/lib/types";
import { changeWorkshopTranscript } from "@/lib/workshop-transcripts";

type Route = { params: Promise<{ id: string; sessionId: string }> };

export async function GET(_request: Request, context: Route) {
  return apiResponse(async () => {
    const id = await projectId(context);
    const session = uuid.parse((await context.params).sessionId);
    const workspace = await getWorkspace(id);
    if (!workspace) throw new ApiError(404, "Projektia ei löytynyt.");
    const workshop = workspace.sessions.find((workshop) => workshop.id === session);
    if (!workshop) throw new ApiError(404, "Työpaja ei kuulu projektiin.");
    return Response.json({ transcripts: workshop.transcripts });
  });
}

export async function POST(request: Request, context: Route) {
  return apiResponse(() => changeWorkshopTranscript(request, context, "add"));
}

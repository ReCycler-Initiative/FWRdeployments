import { apiResponse } from "@/lib/api";
import { uuid } from "@/lib/types";
import { changeWorkshopTranscript } from "@/lib/workshop-transcripts";

type Route = { params: Promise<{ id: string; sessionId: string; transcriptId: string }> };

export async function PUT(request: Request, context: Route) {
  return apiResponse(async () => changeWorkshopTranscript(request, context, "replace", uuid.parse((await context.params).transcriptId)));
}

export async function DELETE(request: Request, context: Route) {
  return apiResponse(async () => changeWorkshopTranscript(request, context, "remove", uuid.parse((await context.params).transcriptId)));
}

import { apiResponse } from "@/lib/api";
import { changeWorkshopTranscript } from "@/lib/workshop-transcripts";

type Route = { params: Promise<{ id: string; sessionId: string }> };

export async function POST(request: Request, context: Route) {
  return apiResponse(() => changeWorkshopTranscript(request, context, "add"));
}

export async function DELETE(request: Request, context: Route) {
  return apiResponse(() => changeWorkshopTranscript(request, context, "remove"));
}

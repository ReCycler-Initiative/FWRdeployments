import {
  apiResponse, callWorker, jsonBody, projectId, requireSameOrigin, type ProjectRoute,
} from "@/lib/api";
import { z } from "zod";
import { uuid } from "@/lib/types";

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const input = await jsonBody(request, z.object({ session_id: uuid.optional() }));
    const response = await callWorker(id, "generate-agenda", input);
    return Response.json(await response.json());
  });
}

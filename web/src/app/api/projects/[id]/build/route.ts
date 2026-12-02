import { z } from "zod";
import {
  apiResponse, callWorker, jsonBody, projectId, requireSameOrigin, type ProjectRoute,
} from "@/lib/api";
import { uuid } from "@/lib/types";

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const input = await jsonBody(request, z.object({ candidate_id: uuid }));
    const response = await callWorker(id, "build", input);
    return Response.json(await response.json(), { status: 202 });
  });
}

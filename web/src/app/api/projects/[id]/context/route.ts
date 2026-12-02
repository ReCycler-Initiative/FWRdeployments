import {
  apiResponse, jsonBody, projectId, requireSameOrigin, type ProjectRoute,
} from "@/lib/api";
import { saveContext } from "@/lib/context";
import { createContextSchema } from "@/lib/types";

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const input = await jsonBody(request, createContextSchema);
    const document = await saveContext(id, { ...input, source_type: "text" });
    return Response.json(document, { status: 201 });
  });
}

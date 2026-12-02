import { z } from "zod";
import { apiResponse, ApiError, jsonBody, projectId, requireSameOrigin, type ProjectRoute } from "@/lib/api";
import { getWorkspace } from "@/lib/db";
import { uuid } from "@/lib/types";
import { implementationPlan, implementationPrompt } from "@/lib/prompts";

const promptInput = z.object({
  candidate_id: uuid,
  target: z.enum(["prompt", "copilot", "claude", "plan"]).default("prompt"),
  refinement: z.string().trim().max(5000).default(""),
});

async function generate(id: string, input: z.infer<typeof promptInput>) {
  const workspace = await getWorkspace(id);
  if (!workspace) throw new ApiError(404, "Projektia ei löytynyt.");
  const candidate = workspace.candidates.find((candidate) => candidate.id === input.candidate_id);
  if (!candidate) throw new ApiError(404, "Kandidaatti ei kuulu projektiin.");
  return Response.json({
    target: input.target === "plan" ? "plan" : "prompt", mock: true, method: "template",
    prompt: input.target === "plan" ? implementationPlan(workspace, candidate, input.refinement)
      : implementationPrompt(workspace, candidate, input.refinement),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function GET(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    const id = await projectId(context);
    const params = new URL(request.url).searchParams;
    return generate(id, promptInput.parse({
      candidate_id: params.get("candidate_id"), target: params.get("target") ?? "prompt",
    }));
  });
}

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    return generate(await projectId(context), await jsonBody(request, promptInput));
  });
}

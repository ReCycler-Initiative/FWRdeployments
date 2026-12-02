import { apiResponse, jsonBody, requireSameOrigin } from "@/lib/api";
import { getDatabase, listProjects } from "@/lib/db";
import { createProjectSchema, projectSchema } from "@/lib/types";
import { getLocale } from "@/lib/locale";

export async function GET() {
  return apiResponse(async () => Response.json(await listProjects()));
}

export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const input = await jsonBody(request, createProjectSchema);
    const result = await getDatabase().query(
      "INSERT INTO projects (title, description, target_systems, language) VALUES ($1, $2, $3::jsonb, $4) RETURNING *",
      [input.title, input.description, JSON.stringify(input.target_systems), input.language ?? await getLocale()],
    );
    return Response.json(projectSchema.parse(result.rows[0]), { status: 201 });
  });
}

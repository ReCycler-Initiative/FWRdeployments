import { z } from "zod";
import { apiResponse, ApiError, jsonBody, projectId, requireSameOrigin, type ProjectRoute } from "@/lib/api";
import { ensureOpenIteration, requireEvidenceEditing, transaction } from "@/lib/db";
import { sessionSchema } from "@/lib/types";

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const input = await jsonBody(request, z.object({
      title: z.string().trim().min(1).max(200),
      notes: z.string().trim().max(10000).default(""),
      scheduled_at: z.iso.datetime().nullable().default(null),
      meeting_url: z.string().max(1000).refine((value) => {
        if (!value) return true;
        try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
        catch { return false; }
      }, "Kokouslinkin tulee olla HTTPS-osoite ilman tunnuksia.").default(""),
    }));
    const workshop = await transaction(async (client) => {
      const project = await client.query("SELECT status FROM projects WHERE id=$1 FOR UPDATE", [id]);
      if (!project.rows[0]) throw new ApiError(404, "Projektia ei löytynyt.");
      if (!["PREPARATION", "CANDIDATES_READY", "READY_FOR_REVIEW"].includes(project.rows[0].status)) {
        throw new ApiError(409, "Työpajoja voi suunnitella valmistelussa tai työpajojen välillä.");
      }
      await requireEvidenceEditing(client, id);
      await ensureOpenIteration(client, id);
      const result = await client.query(
        "INSERT INTO sessions (project_id,title,notes,scheduled_at,meeting_url) VALUES ($1,$2,$3,$4,$5) RETURNING *",
        [id, input.title, input.notes, input.scheduled_at, input.meeting_url || null],
      );
      if (project.rows[0].status === "READY_FOR_REVIEW") await client.query("UPDATE projects SET status='PREPARATION' WHERE id=$1", [id]);
      return sessionSchema.parse({ ...result.rows[0], transcripts: [] });
    });
    return Response.json(workshop, { status: 201 });
  });
}

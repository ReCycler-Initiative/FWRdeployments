import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { apiResponse, ApiError, projectId, requireSameOrigin } from "@/lib/api";
import { transaction } from "@/lib/db";
import { projectMedia } from "@/lib/media";
import { uuid } from "@/lib/types";
import { readWorkshopFile, removeWorkshopFile } from "@/lib/workshop-files";

type Route = { params: Promise<{ id: string; sessionId: string }> };

async function change(request: Request, context: Route, remove: boolean) {
  requireSameOrigin(request);
  const id = await projectId(context);
  const sessionId = uuid.parse((await context.params).sessionId);
  if (Number(request.headers.get("content-length")) > 2 * 1024 * 1024 + 65536) {
    throw new ApiError(413, "Tekstilitterointi saa olla enintään 2 Mt.");
  }
  const file = remove ? null : await readWorkshopFile((await request.formData()).get("file"), false);
  const filename = file ? path.join(projectMedia(id), `transcript-${randomUUID()}${file.extension}`) : null;
  let previousPath: string | null = null;
  let written = false;
  try {
    await transaction(async (client) => {
      const project = await client.query("SELECT status FROM projects WHERE id=$1 FOR UPDATE", [id]);
      if (!project.rows[0]) throw new ApiError(404, "Projektia ei löytynyt.");
      if (["BUILDING", "WORKSHOP_UPLOADED"].includes(project.rows[0].status)) {
        const running = await client.query(
          "SELECT id FROM sessions WHERE project_id=$1 AND pain_points_json->>'status'='running'", [id],
        );
        if (project.rows[0].status === "BUILDING" || running.rows.length) {
          throw new ApiError(409, "Transkriptiota ei voi muuttaa analyysin tai agenttityön aikana.");
        }
      }
      const result = await client.query("SELECT * FROM sessions WHERE id=$1 AND project_id=$2 FOR UPDATE", [sessionId, id]);
      const workshop = result.rows[0];
      if (!workshop) throw new ApiError(404, "Työpaja ei kuulu projektiin.");
      if (remove && !workshop.transcript_path && !workshop.transcript_vtt) {
        throw new ApiError(409, "Työpajalla ei ole poistettavaa transkriptiota.");
      }
      previousPath = workshop.transcript_path;
      if (file && filename) {
        await mkdir(projectMedia(id), { recursive: true });
        await writeFile(filename, file.bytes, { flag: "wx" });
        written = true;
      }
      const video = workshop.video_path?.toLowerCase().endsWith(".mp4") ? workshop.video_path : null;
      await client.query(
        `UPDATE sessions SET transcript_path=$3, transcript_filename=$4, transcript_vtt=$5, video_path=$6,
         processed_at=NULL, pain_points_json=$7::jsonb, current_state_mermaid=NULL, analysis_mode=NULL,
         uploaded_at=CASE WHEN $3::text IS NULL AND $6::text IS NULL THEN NULL ELSE now() END
         WHERE id=$1 AND project_id=$2`,
        [sessionId, id, filename, file?.filename ?? null, file?.transcript ?? null, video,
          file || video ? JSON.stringify({ status: "pending" }) : null],
      );
      await client.query("UPDATE solution_candidates SET is_superseded=true WHERE project_id=$1", [id]);
      await client.query(
        `UPDATE projects SET status=CASE WHEN EXISTS (
          SELECT 1 FROM sessions WHERE project_id=$1 AND (video_path IS NOT NULL OR transcript_path IS NOT NULL)
         ) THEN 'WORKSHOP_UPLOADED' ELSE 'PREPARATION' END WHERE id=$1`, [id],
      );
    });
  } catch (error) {
    if (written && filename) await unlink(filename);
    throw error;
  }
  if (previousPath) await removeWorkshopFile(id, previousPath);
  return Response.json({ status: remove ? "removed" : "saved", session_id: sessionId });
}

export async function POST(request: Request, context: Route) {
  return apiResponse(() => change(request, context, false));
}

export async function DELETE(request: Request, context: Route) {
  return apiResponse(() => change(request, context, true));
}

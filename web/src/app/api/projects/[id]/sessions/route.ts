import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  apiResponse, ApiError, callWorker, projectId, requireSameOrigin, type ProjectRoute,
} from "@/lib/api";
import { getDatabase, transaction } from "@/lib/db";
import { projectMedia } from "@/lib/media";
import { readWorkshopFile } from "@/lib/workshop-files";

const maxBytes = 100 * 1024 * 1024;

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    if (Number(request.headers.get("content-length")) > maxBytes + 65536) {
      throw new ApiError(413, "Tallenne saa olla enintään 100 Mt.");
    }
    const form = await request.formData();
    const title = z.string().trim().min(1).max(200).parse(form.get("title") ?? "Työpaja");
    const workshopId = z.string().uuid().nullable().parse(form.get("session_id") || null);
    const analyze = z.enum(["true", "false"]).parse(form.get("analyze") ?? "true") === "true";
    const { bytes, extension, transcript, filename: originalName } = await readWorkshopFile(form.get("file"));
    const sessionId = workshopId ?? randomUUID();
    const directory = projectMedia(id);
    const filename = path.join(directory, `${sessionId}${extension}`);
    let written = false;
    try {
      await transaction(async (client) => {
        const project = await client.query("SELECT status FROM projects WHERE id = $1 FOR UPDATE", [id]);
        if (!project.rows[0]) throw new ApiError(404, "Projektia ei löytynyt.");
        const running = await client.query(
          "SELECT id FROM sessions WHERE project_id=$1 AND pain_points_json->>'status'='running'", [id],
        );
        if (project.rows[0].status === "BUILDING" || running.rows.length) {
          throw new ApiError(409, "Aineistoa ei voi lisätä analyysin tai agenttityön aikana.");
        }
        if (workshopId) {
          const workshop = await client.query("SELECT video_path, transcript_path FROM sessions WHERE id=$1 AND project_id=$2 FOR UPDATE", [workshopId, id]);
          if (!workshop.rows[0]) throw new ApiError(404, "Työpaja ei kuulu projektiin.");
          if (transcript && (workshop.rows[0].video_path || workshop.rows[0].transcript_path)) {
            throw new ApiError(409, "Tähän työpajaan on jo liitetty tallenne.");
          }
          if (!transcript && workshop.rows[0].video_path?.toLowerCase().endsWith(".mp4")) {
            throw new ApiError(409, "Työpajalle on jo lisätty video.");
          }
        }
        await mkdir(directory, { recursive: true });
        await writeFile(filename, bytes, { flag: "wx" });
        written = true;
        if (workshopId) {
          await client.query(
            `UPDATE sessions SET video_path=$2,
             transcript_vtt=COALESCE($3,transcript_vtt), transcript_path=COALESCE($4,transcript_path),
             transcript_filename=COALESCE($5,transcript_filename), uploaded_at=now(),
             processed_at=NULL, pain_points_json=NULL, current_state_mermaid=NULL, analysis_mode=NULL WHERE id=$1`,
            [workshopId, filename, transcript, transcript ? filename : null, transcript ? originalName : null]);
        } else {
          await client.query(
            `INSERT INTO sessions (id, project_id, video_path, transcript_vtt, title, transcript_path, transcript_filename, uploaded_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, now())`,
            [sessionId, id, filename, transcript, title, transcript ? filename : null, transcript ? originalName : null],
          );
        }
        await client.query("UPDATE projects SET status = 'WORKSHOP_UPLOADED' WHERE id = $1", [id]);
        await client.query("UPDATE solution_candidates SET is_superseded=true WHERE project_id=$1", [id]);
      });
    } catch (error) {
      if (written) await unlink(filename);
      throw error;
    }
    if (!analyze) return Response.json({ session_id: sessionId, status: "saved" }, { status: 201 });
    try {
      await callWorker(id, "analyze", { session_id: sessionId });
    } catch (error) {
      const message = error instanceof ApiError ? error.message : "Analyysin käynnistys epäonnistui.";
      await getDatabase().query(
        "UPDATE sessions SET pain_points_json = $2::jsonb WHERE id = $1 AND processed_at IS NULL AND pain_points_json IS NULL",
        [sessionId, JSON.stringify({ error: message })],
      );
      throw error;
    }
    return Response.json({ session_id: sessionId, status: "accepted" }, { status: 202 });
  });
}

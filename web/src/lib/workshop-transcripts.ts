import "server-only";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { PoolClient } from "pg";
import { ApiError, projectId, requireSameOrigin } from "./api";
import { transaction } from "./db";
import { projectMedia } from "./media";
import { uuid } from "./types";
import { readWorkshopFile, removeWorkshopFile } from "./workshop-files";

type TranscriptRoute = { params: Promise<{ id: string; sessionId: string }> };
type StoredPart = { id: string; title: string; filename: string; storage_path: string | null; content: string };

export async function insertTranscript(client: PoolClient, project: string, session: string, part: Omit<StoredPart, "id">, replaceId?: string) {
  const duplicate = await client.query(
    `SELECT id FROM workshop_transcripts WHERE session_id=$1
     AND content_hash=transcript_fingerprint($2) AND id IS DISTINCT FROM $3::uuid`,
    [session, part.content, replaceId ?? null],
  );
  if (duplicate.rows.length) throw new ApiError(409, "Saman sisältöinen transkriptio on jo tällä työpajalla. VTT/TXT-kopiota ei lisätty.");
  const values = [project, session, part.title, part.filename, part.storage_path, part.content];
  const result = replaceId
    ? await client.query(
      `UPDATE workshop_transcripts SET title=$3,filename=$4,storage_path=$5,content=$6
       WHERE project_id=$1 AND session_id=$2 AND id=$7 RETURNING id`, [...values, replaceId])
    : await client.query(
      `INSERT INTO workshop_transcripts(project_id,session_id,title,filename,storage_path,content)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id`, values);
  if (!result.rows[0]) throw new ApiError(404, "Transkriptio ei kuulu tähän työpajaan.");
  return String(result.rows[0].id);
}

export async function syncWorkshopTranscripts(client: PoolClient, project: string, session: string) {
  const parts = (await client.query<StoredPart>(
    "SELECT id,title,filename,storage_path,content FROM workshop_transcripts WHERE session_id=$1 AND project_id=$2 ORDER BY created_at,id",
    [session, project],
  )).rows;
  const content = parts.length === 1 ? parts[0].content : parts.length
    ? parts.map((part) => `### Transcript: ${part.title} [${part.id}]\n${part.content}`).join("\n\n")
    : null;
  await client.query(
    `UPDATE sessions SET transcript_vtt=$3,transcript_path=$4,transcript_filename=$5,
     video_path=CASE WHEN lower(video_path) LIKE '%.mp4' THEN video_path ELSE NULL END,
     processed_at=NULL,current_state_mermaid=NULL,analysis_mode=NULL,
     pain_points_json=CASE WHEN $6::integer>0 OR lower(video_path) LIKE '%.mp4'
       THEN '{"status":"pending"}'::jsonb ELSE NULL END,
     uploaded_at=CASE WHEN $6::integer>0 OR lower(video_path) LIKE '%.mp4' THEN now() ELSE NULL END
     WHERE id=$1 AND project_id=$2`,
    [session, project, content, parts[0]?.storage_path ?? null, parts[0]?.filename ?? null, parts.length],
  );
  await client.query("UPDATE solution_candidates SET is_superseded=true WHERE project_id=$1", [project]);
  await client.query(
    `UPDATE projects SET status=CASE WHEN EXISTS(SELECT 1 FROM sessions s WHERE s.project_id=$1
      AND (s.video_path IS NOT NULL OR EXISTS(SELECT 1 FROM workshop_transcripts t WHERE t.session_id=s.id)))
      THEN 'WORKSHOP_UPLOADED' ELSE 'PREPARATION' END WHERE id=$1`, [project],
  );
}

export async function changeWorkshopTranscript(request: Request, context: TranscriptRoute, action: "add" | "replace" | "remove", transcriptId?: string) {
  requireSameOrigin(request);
  const project = await projectId(context);
  const session = uuid.parse((await context.params).sessionId);
  if (Number(request.headers.get("content-length")) > 2 * 1024 * 1024 + 65536) throw new ApiError(413, "Tekstilitterointi saa olla enintään 2 Mt.");
  const form = action === "remove" ? null : await request.formData();
  const file = form ? await readWorkshopFile(form.get("file"), false) : null;
  const filename = file ? path.join(projectMedia(project), `transcript-${randomUUID()}${file.extension}`) : null;
  const title = file ? z.string().trim().min(1).max(200).parse(form?.get("title") || file.filename) : null;
  let written = false;
  let changedId = transcriptId;
  try {
    await transaction(async (client) => {
      const status = await client.query("SELECT status FROM projects WHERE id=$1 FOR UPDATE", [project]);
      if (!status.rows[0]) throw new ApiError(404, "Projektia ei löytynyt.");
      const running = await client.query("SELECT id FROM sessions WHERE project_id=$1 AND pain_points_json->>'status'='running'", [project]);
      if (status.rows[0].status === "BUILDING" || running.rows.length) throw new ApiError(409, "Transkriptiota ei voi muuttaa analyysin tai agenttityön aikana.");
      const workshop = await client.query("SELECT id FROM sessions WHERE id=$1 AND project_id=$2 FOR UPDATE", [session, project]);
      if (!workshop.rows[0]) throw new ApiError(404, "Työpaja ei kuulu projektiin.");
      let previousPath: string | null = null;
      if (action !== "add") {
        const records = await client.query<StoredPart>(
          `SELECT id,storage_path FROM workshop_transcripts WHERE session_id=$1 AND project_id=$2
           AND ($3::uuid IS NULL OR id=$3) FOR UPDATE`, [session, project, transcriptId ?? null],
        );
        if (!records.rows.length) throw new ApiError(404, "Transkriptio ei kuulu tähän työpajaan.");
        if (records.rows.length !== 1) throw new ApiError(409, "Valitse poistettava transkriptio. Työpajan muita transkriptioita ei poisteta.");
        changedId = records.rows[0].id;
        previousPath = records.rows[0].storage_path;
      }
      if (action === "remove") {
        await client.query("DELETE FROM workshop_transcripts WHERE id=$1 AND session_id=$2 AND project_id=$3", [changedId, session, project]);
      } else {
        if (!file?.transcript || !filename || !title) throw new ApiError(400, "Valitse tallenne tai litterointi.");
        await mkdir(projectMedia(project), { recursive: true });
        await writeFile(filename, file.bytes, { flag: "wx" });
        written = true;
        changedId = await insertTranscript(client, project, session, {
          title, filename: file.filename, storage_path: filename, content: file.transcript,
        }, action === "replace" ? changedId : undefined);
      }
      await syncWorkshopTranscripts(client, project, session);
      if (previousPath) await removeWorkshopFile(project, previousPath);
    });
  } catch (error) {
    if (written && filename) await unlink(filename);
    throw error;
  }
  return Response.json({ status: action === "remove" ? "removed" : "saved", session_id: session, transcript_id: changedId });
}

import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  apiResponse, ApiError, callWorker, projectId, requireSameOrigin, type ProjectRoute,
} from "@/lib/api";
import { getDatabase, transaction } from "@/lib/db";
import { projectMedia } from "@/lib/media";

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
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new ApiError(400, "Valitse tallenne tai litterointi.");
    const extension = path.extname(file.name).toLowerCase();
    if (![".mp4", ".vtt", ".txt"].includes(extension)) {
      throw new ApiError(400, "Sallitut tiedostotyypit ovat .mp4, .vtt ja .txt.");
    }
    if (file.size > maxBytes) throw new ApiError(413, "Tallenne saa olla enintään 100 Mt.");
    if (extension !== ".mp4" && file.size > 2 * 1024 * 1024) {
      throw new ApiError(413, "Tekstilitterointi saa olla enintään 2 Mt.");
    }
    const bytes = Buffer.from(await file.arrayBuffer());
    let transcript: string | null = null;
    if (extension === ".mp4") {
      if (bytes.length < 12 || bytes.toString("ascii", 4, 8) !== "ftyp") {
        throw new ApiError(400, "Tiedosto ei ole kelvollinen MP4-tallenne.");
      }
    } else {
      try {
        transcript = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      } catch {
        throw new ApiError(400, "Litteroinnin tulee olla UTF-8-tekstiä.");
      }
      if (!transcript.trim() || transcript.includes("\0")) throw new ApiError(400, "Litterointi on tyhjä tai virheellinen.");
      if (extension === ".vtt" && !transcript.trimStart().startsWith("WEBVTT")) {
        throw new ApiError(400, "VTT-litteroinnin tulee alkaa WEBVTT-otsakkeella.");
      }
    }
    const sessionId = workshopId ?? randomUUID();
    const directory = projectMedia(id);
    const filename = path.join(directory, `${sessionId}${extension}`);
    let written = false;
    try {
      await transaction(async (client) => {
        const project = await client.query("SELECT status FROM projects WHERE id = $1 FOR UPDATE", [id]);
        if (!project.rows[0]) throw new ApiError(404, "Projektia ei löytynyt.");
        if (!["PREPARATION", "CANDIDATES_READY"].includes(project.rows[0].status)) {
          throw new ApiError(409, "Uusi tallenne voidaan ladata valmistelussa tai ennen ratkaisun hyväksyntää.");
        }
        if (workshopId) {
          const workshop = await client.query("SELECT video_path FROM sessions WHERE id=$1 AND project_id=$2 FOR UPDATE", [workshopId, id]);
          if (!workshop.rows[0]) throw new ApiError(404, "Työpaja ei kuulu projektiin.");
          if (workshop.rows[0].video_path) throw new ApiError(409, "Tähän työpajaan on jo liitetty tallenne.");
        }
        await mkdir(directory, { recursive: true });
        await writeFile(filename, bytes, { flag: "wx" });
        written = true;
        if (workshopId) {
          await client.query("UPDATE sessions SET video_path=$2, transcript_vtt=$3, uploaded_at=now() WHERE id=$1",
            [workshopId, filename, transcript]);
        } else {
          await client.query(
            "INSERT INTO sessions (id, project_id, video_path, transcript_vtt, title, uploaded_at) VALUES ($1, $2, $3, $4, $5, now())",
            [sessionId, id, filename, transcript, title],
          );
        }
        await client.query("UPDATE projects SET status = 'WORKSHOP_UPLOADED' WHERE id = $1", [id]);
      });
    } catch (error) {
      if (written) await unlink(filename);
      throw error;
    }
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

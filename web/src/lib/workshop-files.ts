import "server-only";
import { rm } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "./api";
import { projectMedia } from "./media";

export async function readWorkshopFile(file: FormDataEntryValue | null, allowVideo = true) {
  if (!(file instanceof File) || !file.size) throw new ApiError(400, "Valitse tallenne tai litterointi.");
  const extension = path.extname(file.name).toLowerCase();
  if (!(allowVideo ? [".mp4", ".vtt", ".txt"] : [".vtt", ".txt"]).includes(extension)) {
    throw new ApiError(400, allowVideo ? "Sallitut tiedostotyypit ovat .mp4, .vtt ja .txt." : "Transkriptio tulee tallentaa VTT- tai TXT-tiedostona.");
  }
  if (file.size > 100 * 1024 * 1024) throw new ApiError(413, "Tallenne saa olla enintään 100 Mt.");
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
    try { transcript = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new ApiError(400, "Litteroinnin tulee olla UTF-8-tekstiä."); }
    if (!transcript.trim() || transcript.includes("\0")) throw new ApiError(400, "Litterointi on tyhjä tai virheellinen.");
    if (extension === ".vtt" && !transcript.trimStart().startsWith("WEBVTT")) {
      throw new ApiError(400, "VTT-litteroinnin tulee alkaa WEBVTT-otsakkeella.");
    }
  }
  return { bytes, extension, transcript, filename: path.basename(file.name).slice(0, 200) };
}

export async function removeWorkshopFile(id: string, filename: string) {
  if (!path.resolve(filename).startsWith(path.resolve(projectMedia(id)) + path.sep)) {
    throw new ApiError(500, "Transkription tiedostopolku ei kuulu projektiin.");
  }
  await rm(filename, { force: true });
}

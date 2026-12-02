import { mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { apiResponse, ApiError, callWorker, projectId, requireSameOrigin, type ProjectRoute } from "@/lib/api";
import { saveContext } from "@/lib/context";
import { projectMedia } from "@/lib/media";
import { getProject } from "@/lib/db";

export async function POST(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const id = await projectId(context);
    const project = await getProject(id);
    if (!project) throw new ApiError(404, "Projektia ei löytynyt.");
    if (!["PREPARATION", "CANDIDATES_READY"].includes(project.status)) throw new ApiError(409, "Materiaalien lisäys on lukittu käsittelyn ajaksi.");
    if (Number(request.headers.get("content-length")) > 10 * 1024 * 1024 + 65536) throw new ApiError(413, "Taustatiedoston raja on 10 Mt.");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new ApiError(400, "Valitse taustatiedosto.");
    const extension = path.extname(file.name).toLowerCase();
    if (![".txt", ".md", ".csv", ".json", ".vtt", ".pdf", ".docx"].includes(extension)) throw new ApiError(400, "Tiedostotyyppiä ei tueta.");
    if (file.size > 10 * 1024 * 1024) throw new ApiError(413, "Taustatiedoston raja on 10 Mt.");
    const directory = path.join(projectMedia(id), "context");
    const filename = path.join(directory, `${randomUUID()}${extension}`);
    await mkdir(directory, { recursive: true });
    await writeFile(filename, Buffer.from(await file.arrayBuffer()), { flag: "wx" });
    try {
      const response = await callWorker(id, "extract-context", { path: filename });
      const text = z.object({ content_text: z.string().min(1).max(100000) }).parse(await response.json());
      const document = await saveContext(id, {
        filename: path.basename(file.name).slice(0, 200), ...text, source_type: "file", storage_path: filename,
      });
      return Response.json(document, { status: 201 });
    } catch (error) {
      await unlink(filename);
      throw error;
    }
  });
}

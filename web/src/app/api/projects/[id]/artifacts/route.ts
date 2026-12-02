import { readFile } from "node:fs/promises";
import path from "node:path";
import { apiResponse, ApiError, projectId, type ProjectRoute } from "@/lib/api";
import { getProject } from "@/lib/db";
import { artifactFile } from "@/lib/media";

export async function GET(request: Request, context: ProjectRoute) {
  return apiResponse(async () => {
    const id = await projectId(context);
    if (!await getProject(id)) throw new ApiError(404, "Projektia ei löytynyt.");
    const search = new URL(request.url).searchParams;
    const relative = search.get("path");
    if (!relative) throw new ApiError(400, "Artefaktipolku puuttuu.");
    const file = await artifactFile(id, relative);
    const download = search.get("download") === "1";
    if (file.size > (download ? 10 * 1024 * 1024 : 128 * 1024)) {
      throw new ApiError(413, download ? "Latausraja on 10 Mt." : "Esikatseluraja on 128 kt. Lataa tiedosto.");
    }
    const content = await readFile(file.path);
    if (!download) return Response.json({ content: content.toString("utf-8") });
    return new Response(content, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(file.path))}`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
        "Cache-Control": "no-store",
      },
    });
  });
}

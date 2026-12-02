import "server-only";
import { readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import type { Artifact } from "./types";
import { ApiError } from "./api";

export function projectMedia(id: string) {
  const root = process.env.MEDIA_DIR;
  if (!root) throw new ApiError(503, "MEDIA_DIR ei ole määritetty.");
  return path.join(root, id);
}

function isMissing(error: unknown) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

export async function listArtifacts(id: string): Promise<Artifact[]> {
  const root = path.join(projectMedia(id), "artifacts");
  const artifacts: Artifact[] = [];
  async function walk(directory: string, depth: number) {
    if (depth > 5) throw new ApiError(500, "Artefaktihakemisto on liian syvä.");
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) await walk(absolute, depth + 1);
      if (entry.isFile()) {
        if (artifacts.length >= 100) throw new ApiError(500, "Artefakteja on yli esikatselun rajan.");
        artifacts.push({
          path: path.relative(root, absolute).split(path.sep).join("/"),
          size: (await stat(absolute)).size,
        });
      }
    }
  }
  try {
    await walk(root, 0);
  } catch (error) {
    if (!isMissing(error)) throw error;
  }
  return artifacts.sort((a, b) => a.path.localeCompare(b.path));
}

export async function artifactFile(id: string, relative: string) {
  const root = await realpath(path.join(projectMedia(id), "artifacts")).catch((error: unknown) => {
    if (isMissing(error)) throw new ApiError(404, "Artefaktia ei löytynyt.");
    throw error;
  });
  const proposed = path.resolve(root, relative);
  if (!proposed.startsWith(root + path.sep)) throw new ApiError(400, "Virheellinen artefaktipolku.");
  const resolved = await realpath(proposed).catch((error: unknown) => {
    if (isMissing(error)) throw new ApiError(404, "Artefaktia ei löytynyt.");
    throw error;
  });
  if (!resolved.startsWith(root + path.sep)) throw new ApiError(403, "Polku ei kuulu projektiin.");
  const info = await stat(resolved);
  if (!info.isFile()) throw new ApiError(400, "Valitse tiedosto.");
  return { path: resolved, size: info.size };
}

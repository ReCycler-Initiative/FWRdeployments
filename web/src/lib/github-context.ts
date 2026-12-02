import "server-only";
import { z } from "zod";
import { ApiError } from "./api";
import { getI18n } from "./locale";

export const githubInput = z.object({
  url: z.string().url().max(300).refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password
      && /^\/[\w.-]+\/[\w.-]+\/?$/.test(url.pathname) && !url.search && !url.hash;
  }, "Anna repositorion HTTPS-osoite muodossa https://github.com/owner/repo."),
  ref: z.string().trim().max(200).optional(),
  token: z.string().max(1000).optional(),
});

export async function importGithub(input: z.infer<typeof githubInput>) {
  const { t } = await getI18n();
  const [owner, rawRepo] = new URL(input.url).pathname.split("/").filter(Boolean);
  const repo = rawRepo.replace(/\.git$/, "");
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28",
  };
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  async function get(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetch(url, { headers, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15000) });
    } catch {
      throw new ApiError(502, "GitHub-yhteys epäonnistui tai aikakatkaistiin.");
    }
    if (!response.ok) throw new ApiError(response.status === 404 ? 404 : 502,
      `${t("GitHub palautti")} ${response.status}. ${t("Tarkista repositorio, tokenin read-only Contents-oikeus ja kutsuraja.")}`);
    return response.json();
  }
  const metadata = z.object({ default_branch: z.string() }).parse(await get(base));
  const commit = z.object({ sha: z.string(), commit: z.object({ tree: z.object({ sha: z.string() }) }) })
    .parse(await get(`${base}/commits/${encodeURIComponent(input.ref || metadata.default_branch)}`));
  const tree = z.object({
    truncated: z.boolean(),
    tree: z.array(z.object({ path: z.string(), type: z.string(), sha: z.string(), size: z.number().optional() })),
  }).parse(await get(`${base}/git/trees/${commit.commit.tree.sha}?recursive=1`));
  if (tree.truncated) throw new ApiError(422, "Repositorion hakemistopuu on liian suuri. Tuo tarvittavat dokumentit tiedostoina.");
  const eligible = tree.tree.filter((file) => file.type === "blob" && (file.size ?? 0) <= 64000
    && !/(^|\/)(node_modules|vendor|dist|build|\.git|\.env[^/]*)\//.test(file.path)
    && !/(^|\/)\.env|lock\.(json|yaml)$|package-lock\.json|yarn\.lock|pnpm-lock/.test(file.path)
    && /\.(md|txt|py|ts|tsx|sql|json|ya?ml)$/i.test(file.path))
    .sort((a, b) => Number(!/readme|^docs\//i.test(a.path)) - Number(!/readme|^docs\//i.test(b.path)) || a.path.localeCompare(b.path));
  const sections: string[] = [`${t("GitHub-lähde:")} ${input.url}\nCommit: ${commit.sha}\n`];
  let imported = 0;
  for (const file of eligible.slice(0, 20)) {
    const blob = z.object({ encoding: z.literal("base64"), content: z.string() })
      .parse(await get(`${base}/git/blobs/${file.sha}`));
    let content: string;
    try { content = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.from(blob.content, "base64")); }
    catch { throw new ApiError(422, `${t("Tiedosto")} ${file.path}: ${t("ei ole UTF-8-tekstiä.")}`); }
    const section = `\n--- ${t("TIEDOSTO:")} ${file.path} ---\n${content}\n`;
    if (sections.join("").length + section.length > 190000) break;
    sections.push(section); imported++;
  }
  if (!imported) throw new ApiError(422, "Repositoriosta ei löytynyt tuettavia tekstidokumentteja tai lähdekooditiedostoja.");
  sections.push(`\n${t("Tuotu")} ${imported}/${eligible.length} ${t("soveltuvaa tiedostoa. Enintään 20 tiedostoa ja 190 000 merkkiä; rajattu lähdesnapshot, ei koko repositorion peilaus.")}`);
  return {
    filename: `GitHub: ${owner}/${repo}@${commit.sha.slice(0, 7)}`,
    content_text: sections.join(""),
    source_type: "github" as const,
    source_url: `https://github.com/${owner}/${repo}`,
    source_revision: commit.sha,
  };
}

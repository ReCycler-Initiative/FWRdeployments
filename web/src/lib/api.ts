import "server-only";
import { z, ZodError } from "zod";
import { uuid } from "./types";
import { getI18n } from "./locale";

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type ProjectRoute = { params: Promise<{ id: string }> };

export async function projectId(context: ProjectRoute) {
  return uuid.parse((await context.params).id);
}

export function requireSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (origin && new URL(origin).host !== host) {
    throw new ApiError(403, "Pyyntö on sallittu vain samasta käyttöliittymästä.");
  }
}

export async function jsonBody<T extends z.ZodType>(request: Request, schema: T) {
  try {
    return schema.parse(await request.json());
  } catch (error) {
    if (error instanceof SyntaxError) throw new ApiError(400, "Virheellinen JSON-pyyntö.");
    throw error;
  }
}

export async function apiResponse(operation: () => Promise<Response>) {
  try {
    return await operation();
  } catch (error) {
    const { t } = await getI18n();
    if (error instanceof ZodError) {
      console.warn("API validation failed", error.issues);
      return Response.json({ error: error.issues.map((issue) => t(issue.message)).join(" ") }, { status: 400 });
    }
    if (error instanceof ApiError) {
      console.warn("API request failed", error.message);
      return Response.json({ error: t(error.message) }, { status: error.status });
    }
    console.error("Unexpected API error", error);
    return Response.json({ error: t("Palvelinvirhe. Tarkista palvelun lokit ja yritä uudelleen.") }, { status: 500 });
  }
}

export async function callWorker(
  id: string, action: "generate-agenda" | "analyze" | "build" | "extract-context", body?: object,
) {
  const base = process.env.WORKER_URL;
  if (!base) throw new ApiError(503, "WORKER_URL ei ole määritetty.");
  let response: Response;
  try {
    response = await fetch(`${base}/api/projects/${id}/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: AbortSignal.timeout(action === "generate-agenda" ? 120000 : action === "extract-context" ? 40000 : 15000),
      cache: "no-store",
    });
  } catch (error) {
    console.error("Worker connection failed", error);
    throw new ApiError(502, "Worker ei vastaa. Tarkista yhteys ja yritä uudelleen.");
  }
  if (!response.ok) {
    const errorBody: unknown = await response.json();
    const detail = z.object({ detail: z.string() }).safeParse(errorBody);
    console.error("Worker request failed", response.status, errorBody);
    throw new ApiError(
      response.status >= 500 ? 502 : response.status,
      detail.success ? detail.data.detail : "Worker hylkäsi pyynnön. Tarkista syötteet ja palvelun lokit.",
    );
  }
  return response;
}

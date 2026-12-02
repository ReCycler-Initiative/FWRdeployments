import "server-only";
import { workerCapabilitiesSchema, type AiCapabilities } from "./types";

export async function getAiCapabilities(): Promise<AiCapabilities> {
  const base = process.env.WORKER_URL;
  if (!base) {
    console.error("Cannot read AI capabilities: WORKER_URL is not configured");
    return { status: "unavailable" };
  }
  try {
    const response = await fetch(`${base}/capabilities`, {
      cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(`Worker capabilities returned HTTP ${response.status}`);
    return { status: "available", ...workerCapabilitiesSchema.parse(await response.json()) };
  } catch (error) {
    console.error("Could not read worker AI capabilities", error);
    return { status: "unavailable" };
  }
}

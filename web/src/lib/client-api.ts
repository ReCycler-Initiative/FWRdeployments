import { z } from "zod";

export async function requestJson<T extends z.ZodType>(
  url: string, options: RequestInit, schema: T,
): Promise<z.output<T>> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", ...options });
  } catch (error) {
    if (options.signal?.aborted) throw error;
    console.error("Request connection failed", error);
    throw new Error("Yhteys palvelimeen epäonnistui. Tarkista yhteys ja yritä uudelleen.");
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    console.error("Invalid API response", response.status, error);
    throw new Error("Palvelin palautti virheellisen vastauksen. Tarkista palvelun lokit.");
  }
  if (!response.ok) {
    const error = z.object({ error: z.string() }).safeParse(body);
    throw new Error(error.success ? error.data.error : `Pyyntö epäonnistui (${response.status}).`);
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    console.error("API response validation failed", result.error);
    throw new Error("Palvelimen vastaus ei vastaa tietomallia. Tarkista palvelun lokit.");
  }
  return result.data;
}

export function postJson(body?: object): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  };
}

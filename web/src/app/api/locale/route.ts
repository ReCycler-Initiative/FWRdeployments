import { z } from "zod";
import { cookies } from "next/headers";
import { apiResponse, jsonBody, requireSameOrigin } from "@/lib/api";

export async function POST(request: Request) {
  return apiResponse(async () => {
    requireSameOrigin(request);
    const { locale } = await jsonBody(request, z.object({ locale: z.enum(["fi", "en"]) }));
    (await cookies()).set("frw_locale", locale, {
      httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:",
      path: "/", maxAge: 60 * 60 * 24 * 365,
    });
    return Response.json({ locale });
  });
}

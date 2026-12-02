import { getDatabase } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await getDatabase().query("SELECT 1");
    return Response.json({ status: "ok", database: "ok" });
  } catch (error) {
    console.error("Database health check failed", error);
    return Response.json(
      { status: "error", database: "unavailable" },
      { status: 503 },
    );
  }
}

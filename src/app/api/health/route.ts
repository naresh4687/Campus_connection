import { sql } from "kysely";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** Liveness + database reachability. Deliberately returns no internal details. */
export async function GET() {
  try {
    await sql`SELECT 1`.execute(db());
    return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    console.error("health check failed:", err instanceof Error ? err.message : "unknown error");
    return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

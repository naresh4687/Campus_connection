import { sql } from "kysely";
import { NextResponse } from "next/server";
import { uuidSchema } from "@/lib/validation";
import { appBaseUrl } from "@/server/auth/links";
import { allow } from "@/server/auth/rate-limit";
import { candidateSessions, withSession } from "@/server/auth/session";
import { signedDownloadUrl } from "@/server/storage/s3";

export const dynamic = "force-dynamic";

/**
 * The only way to open an external-registration screenshot. The database decides (the student who owns it, an officer of the college, or the
 * coordinator of the student's current department), records every look in the audit log, and only then is a 60-second signed link minted.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const sessions = await candidateSessions();
  if (sessions.length === 0) return NextResponse.redirect(new URL("/login", await appBaseUrl()), 303);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  let refused = false;
  for (const s of sessions) {
    if (!(await allow("evidence-download", s.userId, 200, 3600))) return new NextResponse("Too many requests", { status: 429 });
    let row: { storage_key: string; content_type: string; original_name: string } | undefined;
    try {
      row = await withSession(s, async (t) => (await sql<{ storage_key: string; content_type: string; original_name: string }>`SELECT * FROM registrations.evidence_key(${id}::uuid)`.execute(t)).rows[0]);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "42501") { refused = true; continue; }
      if (code === "22023") continue;
      console.error("evidence authorisation failed:", code, (e as Error).message);
      return new NextResponse("Error", { status: 500 });
    }
    if (!row) continue;
    const url = await signedDownloadUrl(row.storage_key, row.original_name, row.content_type);
    return new NextResponse(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  }
  return refused ? new NextResponse("Forbidden", { status: 403 }) : new NextResponse("Not found", { status: 404 });
}

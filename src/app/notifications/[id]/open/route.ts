import { sql } from "kysely";
import { NextResponse } from "next/server";
import { uuidSchema } from "@/lib/validation";
import { appBaseUrl } from "@/server/auth/links";
import { candidateSessions, withSession } from "@/server/auth/session";
import { scopedHref } from "@/lib/portals";

export const dynamic = "force-dynamic";

/**
 * Marks the notification read, then goes to its stored deep link. The link is a relative application path enforced by a database
 * constraint (never an external URL), and the notification is only visible to its owner, so this cannot be used as an open redirect.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const base = await appBaseUrl();
  // A notification is visible only to its owner: use whichever signed-in account owns it.
  const sessions = await candidateSessions();
  if (sessions.length === 0) return NextResponse.redirect(new URL("/login", base), 303);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  let link: string | null = null;
  for (const s of sessions) {
    try {
      link = await withSession(s, async (t) => {
        const row = (await sql<{ link: string | null }>`SELECT link FROM notifications WHERE id = ${id}`.execute(t)).rows[0];
        if (!row) return null;
        await sql`SELECT notifications.mark_read(${id}::uuid)`.execute(t);
        return row.link ?? scopedHref("/notifications", s.slot);
      });
    } catch (e) {
      console.error("notification open failed:", (e as { code?: string }).code);
      return new NextResponse("Error", { status: 500 });
    }
    if (link) break;
  }
  // Only ever redirect within this site: resolve the stored link and require our own origin (catches "//x", "/\\x" and similar).
  const target = link && link.startsWith("/") ? new URL(link, base) : null;
  if (!target || target.origin !== new URL(base).origin) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(target, 303);
}

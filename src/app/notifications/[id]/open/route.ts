import { sql } from "kysely";
import { NextResponse } from "next/server";
import { uuidSchema } from "@/lib/validation";
import { appBaseUrl } from "@/server/auth/links";
import { getSession, withSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

/**
 * Marks the notification read, then goes to its stored deep link. The link is a relative application path enforced by a database
 * constraint (never an external URL), and the notification is only visible to its owner, so this cannot be used as an open redirect.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const base = await appBaseUrl();
  const s = await getSession();
  if (!s) return NextResponse.redirect(new URL("/login", base), 303);
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  let link: string | null = null;
  try {
    link = await withSession(s, async (t) => {
      const row = (await sql<{ link: string | null }>`SELECT link FROM notifications WHERE id = ${id}`.execute(t)).rows[0];
      if (!row) return null;
      await sql`SELECT notifications.mark_read(${id}::uuid)`.execute(t);
      return row.link ?? "/notifications";
    });
  } catch (e) {
    console.error("notification open failed:", (e as { code?: string }).code);
    return new NextResponse("Error", { status: 500 });
  }
  if (!link || !link.startsWith("/") || link.startsWith("//")) return new NextResponse("Not found", { status: 404 });
  return NextResponse.redirect(new URL(link, base), 303);
}

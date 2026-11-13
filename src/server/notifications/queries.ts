import { sql } from "kysely";
import { PAGE_SIZE } from "@/components/ui/pagination";
import { withSession, type SessionUser } from "../auth/session";

export type NotificationRow = { id: string; category: string; title: string; body: string | null; link: string | null; created_at: Date; read_at: Date | null };

export async function unreadCount(s: SessionUser) {
  if (!s.collegeId) return 0;
  return withSession(s, async (t) => Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM notifications WHERE read_at IS NULL`.execute(t)).rows[0].n));
}

/** The signed-in user's own notifications, newest first (RLS limits the rows; there is no user filter on purpose). */
export async function listNotifications(s: SessionUser, page: number) {
  return withSession(s, async (t) => {
    const total = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM notifications`.execute(t)).rows[0].n);
    const rows = (await sql<NotificationRow>`SELECT id, category, title, body, link, created_at, read_at FROM notifications ORDER BY created_at DESC, id LIMIT ${PAGE_SIZE} OFFSET ${(page - 1) * PAGE_SIZE}`.execute(t)).rows;
    return { rows, total };
  });
}

export async function preferenceMap(s: SessionUser) {
  return withSession(s, async (t) => Object.fromEntries((await sql<{ category: string; enabled: boolean }>`SELECT category, enabled FROM notification_preferences`.execute(t)).rows.map((r) => [r.category, r.enabled])) as Record<string, boolean>);
}

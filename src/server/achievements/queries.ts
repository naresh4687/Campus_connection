import { sql } from "kysely";
import { PAGE_SIZE } from "@/components/ui/pagination";
import { likePattern } from "@/lib/validation";
import { withSession, type SessionUser } from "../auth/session";

// Reads run as the signed-in user under RLS: a student sees their own, a coordinator those of their assigned departments, an admin all.
export type Achievement = {
  id: string; student_id: string; kind: string; title: string; achieved_on: string; description: string | null; link: string | null; status: string;
  submitted_at: Date; reviewed_by_name: string | null; reviewed_at: Date | null; review_note: string | null; rejection_reason: string | null;
  replaces_id: string | null; has_open_revision: boolean;
};
const COLS = sql`a.id, a.student_id, a.kind, a.title, to_char(a.achieved_on, 'YYYY-MM-DD') AS achieved_on, a.description, a.link, a.status, a.submitted_at, a.reviewed_by_name, a.reviewed_at, a.review_note, a.rejection_reason, a.replaces_id,
  EXISTS (SELECT 1 FROM student_achievements r WHERE r.replaces_id = a.id AND r.status = 'SUBMITTED') AS has_open_revision`;

/** One student's entries, newest achievement first (their own, or one the viewer may see). */
export async function achievementsFor(s: SessionUser, studentId?: string) {
  return withSession(s, async (t) => (await (studentId
    ? sql<Achievement>`SELECT ${COLS} FROM student_achievements a WHERE a.student_id = ${studentId} AND a.status NOT IN ('WITHDRAWN', 'SUPERSEDED') ORDER BY a.achieved_on DESC, a.submitted_at DESC`
    : sql<Achievement>`SELECT ${COLS} FROM student_achievements a WHERE a.status NOT IN ('WITHDRAWN', 'SUPERSEDED') ORDER BY a.achieved_on DESC, a.submitted_at DESC`).execute(t)).rows);
}

export type AchievementQueueRow = Achievement & { full_name: string; register_number: string; dept_code: string; original: { kind: string; title: string; achieved_on: string; description: string | null; link: string | null } | null };

/** Entries awaiting a coordinator's decision, oldest first. */
export async function achievementQueue(s: SessionUser, f: { q?: string; page: number }) {
  return withSession(s, async (t) => {
    const q = f.q ? sql`AND (st.full_name ILIKE ${likePattern(f.q)} ESCAPE '\\' OR st.register_number::text ILIKE ${likePattern(f.q)} ESCAPE '\\')` : sql``;
    const total = Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM student_achievements a JOIN students st ON st.id = a.student_id WHERE a.status = 'SUBMITTED' ${q}`.execute(t)).rows[0].n);
    const rows = (await sql<AchievementQueueRow>`
      SELECT ${COLS}, st.full_name, st.register_number::text AS register_number, d.code::text AS dept_code,
             (SELECT json_build_object('kind', o.kind, 'title', o.title, 'achieved_on', to_char(o.achieved_on, 'YYYY-MM-DD'), 'description', o.description, 'link', o.link) FROM student_achievements o WHERE o.id = a.replaces_id) AS original
        FROM student_achievements a JOIN students st ON st.id = a.student_id JOIN departments d ON d.id = st.department_id
       WHERE a.status = 'SUBMITTED' ${q} ORDER BY a.submitted_at, a.id LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    return { rows, total };
  });
}

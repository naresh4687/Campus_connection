import { sql } from "kysely";
import { db } from "../db";
import { withSession, type SessionUser } from "../auth/session";

export type JoinPage = { college_name: string; departments: { id: string; code: string; name: string; degree: string | null }[] };

/** What the public sign-up page may show: the college's name and its ACTIVE departments — only if the link is switched on and current. */
export async function peekJoin(college: string, version: number): Promise<JoinPage | null> {
  return (await sql<JoinPage>`SELECT * FROM students.peek_join(${college}::uuid, ${version}::int)`.execute(db())).rows[0] ?? null;
}

export async function joinLinkState(s: SessionUser) {
  return withSession(s, async (t) => (await sql<{ enabled: boolean; version: number }>`SELECT * FROM students.join_link_state()`.execute(t)).rows[0]);
}

export type JoinRequestRow = {
  id: string; full_name: string; register_number: string; college_email: string; personal_email: string | null; phone: string; degree: string; admission_year: number; passing_year: number;
  dept_code: string; dept_name: string; status: string; decided_by_name: string | null; decided_at: Date | null; decision_reason: string | null; created_at: Date;
};

/** Requests the signed-in user may see (RLS: an administrator sees the college's, a coordinator only their departments'). Pending first. */
export async function joinRequests(s: SessionUser) {
  return withSession(s, async (t) => (await sql<JoinRequestRow>`
    SELECT r.id, r.full_name, r.register_number::text AS register_number, r.college_email::text AS college_email, r.personal_email::text AS personal_email, r.phone, r.degree, r.admission_year, r.passing_year,
           d.code::text AS dept_code, d.name::text AS dept_name, r.status, r.decided_by_name, r.decided_at, r.decision_reason, r.created_at
      FROM join_requests r JOIN departments d ON d.id = r.department_id
     ORDER BY (r.status = 'PENDING') DESC, r.created_at DESC LIMIT 200`.execute(t)).rows);
}

export async function pendingJoinCount(s: SessionUser) {
  return withSession(s, async (t) => Number((await sql<{ n: number }>`SELECT count(*)::int AS n FROM join_requests WHERE status = 'PENDING'`.execute(t)).rows[0].n));
}

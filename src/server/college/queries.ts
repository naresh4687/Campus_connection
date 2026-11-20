import { sql, type RawBuilder } from "kysely";
import { PAGE_SIZE } from "@/components/ui/pagination";
import { likePattern } from "@/lib/validation";
import { withSession, type SessionUser } from "../auth/session";

// Every read runs as the signed-in user under RLS (db/migrations/0002–0004). `college_id` is never taken from the client.
const where = (c: RawBuilder<unknown>[]) => (c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``);
const n = (v: unknown) => Number(v ?? 0);

export type DepartmentRow = { id: string; name: string; code: string; description: string | null; status: string; coordinators: number; students: number };

export async function listDepartments(s: SessionUser) {
  return withSession(s, async (t) =>
    (await sql<DepartmentRow>`
      SELECT d.id, d.name::text AS name, d.code::text AS code, d.description, d.status,
        (SELECT count(*)::int FROM coordinator_assignments a WHERE a.department_id = d.id AND a.ended_at IS NULL) AS coordinators,
        (SELECT count(*)::int FROM students st WHERE st.department_id = d.id) AS students
      FROM departments d ORDER BY d.status, d.code`.execute(t)).rows,
  );
}

export async function getDepartment(s: SessionUser, id: string) {
  return withSession(s, async (t) => {
    const dept = (await sql<{ id: string; name: string; code: string; description: string | null; status: string; created_at: Date }>`
      SELECT id, name::text AS name, code::text AS code, description, status, created_at FROM departments WHERE id = ${id}`.execute(t)).rows[0];
    if (!dept) return null;
    const assigned = (await sql<{ user_id: string; full_name: string; email: string; status: string; assigned_at: Date }>`
      SELECT u.id AS user_id, u.full_name, u.email::text AS email, u.status, a.assigned_at
      FROM coordinator_assignments a JOIN users u ON u.id = a.user_id
      WHERE a.department_id = ${id} AND a.ended_at IS NULL ORDER BY u.full_name`.execute(t)).rows;
    const assignable = (await sql<{ id: string; full_name: string; email: string }>`
      SELECT u.id, u.full_name, u.email::text AS email FROM users u
      WHERE u.role = 'COORDINATOR' AND u.status = 'ACTIVE'
        AND NOT EXISTS (SELECT 1 FROM coordinator_assignments a WHERE a.department_id = ${id} AND a.user_id = u.id AND a.ended_at IS NULL)
      ORDER BY u.full_name`.execute(t)).rows;
    return { dept, assigned, assignable };
  });
}

export type StaffRow = { id: string; full_name: string; email: string; role: string; status: string; last_login_at: Date | null; departments: string[] };

export async function listStaff(s: SessionUser, f: { q?: string; role?: string; status?: string; page: number }) {
  return withSession(s, async (t) => {
    const c: RawBuilder<unknown>[] = [sql`u.role IN ('COLLEGE_ADMIN', 'PLACEMENT_OFFICER', 'COORDINATOR')`];
    if (f.role && ["COLLEGE_ADMIN", "PLACEMENT_OFFICER", "COORDINATOR"].includes(f.role)) c.push(sql`u.role = ${f.role}`);
    if (f.status === "ACTIVE" || f.status === "DISABLED") c.push(sql`u.status = ${f.status}`);
    if (f.q) c.push(sql`(u.full_name ILIKE ${likePattern(f.q)} ESCAPE '\\' OR u.email::text ILIKE ${likePattern(f.q)} ESCAPE '\\')`);
    const w = where(c);
    const total = n((await sql<{ n: number }>`SELECT count(*)::int AS n FROM users u ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<StaffRow>`
      SELECT u.id, u.full_name, u.email::text AS email, u.role, u.status, u.last_login_at,
        COALESCE((SELECT array_agg(d.code::text ORDER BY d.code) FROM coordinator_assignments a JOIN departments d ON d.id = a.department_id
                   WHERE a.user_id = u.id AND a.ended_at IS NULL), '{}') AS departments
      FROM users u ${w} ORDER BY u.role, u.full_name, u.id LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    const pending = (await sql<{ id: string; email: string; role: string; expires_at: Date; created_at: Date; department: string | null }>`
      SELECT i.id, i.email::text AS email, i.role, i.expires_at, i.created_at, d.name::text AS department FROM invitations i LEFT JOIN departments d ON d.id = i.department_id
      WHERE i.role IN ('PLACEMENT_OFFICER', 'COORDINATOR') AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
      ORDER BY i.created_at DESC LIMIT 100`.execute(t)).rows;
    return { rows, total, pending };
  });
}

export async function getStaff(s: SessionUser, id: string) {
  return withSession(s, async (t) => {
    const user = (await sql<{ id: string; full_name: string; email: string; role: string; status: string; last_login_at: Date | null; created_at: Date }>`
      SELECT id, full_name, email::text AS email, role, status, last_login_at, created_at FROM users
      WHERE id = ${id} AND role IN ('COLLEGE_ADMIN', 'PLACEMENT_OFFICER', 'COORDINATOR')`.execute(t)).rows[0];
    if (!user) return null;
    const assigned = (await sql<{ department_id: string; code: string; name: string; status: string; assigned_at: Date }>`
      SELECT d.id AS department_id, d.code::text AS code, d.name::text AS name, d.status, a.assigned_at
      FROM coordinator_assignments a JOIN departments d ON d.id = a.department_id
      WHERE a.user_id = ${id} AND a.ended_at IS NULL ORDER BY d.code`.execute(t)).rows;
    const assignable = user.role === "COORDINATOR" && user.status === "ACTIVE"
      ? (await sql<{ id: string; code: string; name: string }>`
          SELECT d.id, d.code::text AS code, d.name::text AS name FROM departments d
          WHERE d.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM coordinator_assignments a WHERE a.department_id = d.id AND a.user_id = ${id} AND a.ended_at IS NULL)
          ORDER BY d.code`.execute(t)).rows
      : [];
    return { user, assigned, assignable };
  });
}

export async function getCollegeProfile(s: SessionUser) {
  return withSession(s, async (t) =>
    (await sql<{ id: string; name: string; official_email: string | null; status: string; address: string | null; district: string | null; state: string | null; website: string | null; contact_person: string | null; contact_phone: string | null; approx_students: number | null; college_type: string | null }>`
      SELECT id, name, official_email::text AS official_email, status, address, district, state, website, contact_person, contact_phone, approx_students, college_type FROM colleges`.execute(t)).rows[0] ?? null,
  );
}

export async function dashboard(s: SessionUser) {
  return withSession(s, async (t) => {
    const dep = (await sql<{ active: number; inactive: number; without_coordinator: number }>`
      SELECT count(*) FILTER (WHERE d.status = 'ACTIVE')::int AS active, count(*) FILTER (WHERE d.status = 'INACTIVE')::int AS inactive,
             count(*) FILTER (WHERE d.status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM coordinator_assignments a JOIN users cu ON cu.id = a.user_id AND cu.status = 'ACTIVE'
                                                                          WHERE a.department_id = d.id AND a.ended_at IS NULL))::int AS without_coordinator
      FROM departments d`.execute(t)).rows[0];
    const staff = (await sql<{ officers: number; officers_disabled: number; coordinators: number; coordinators_disabled: number; unassigned: number }>`
      SELECT count(*) FILTER (WHERE role = 'PLACEMENT_OFFICER' AND status = 'ACTIVE')::int AS officers,
             count(*) FILTER (WHERE role = 'PLACEMENT_OFFICER' AND status = 'DISABLED')::int AS officers_disabled,
             count(*) FILTER (WHERE role = 'COORDINATOR' AND status = 'ACTIVE')::int AS coordinators,
             count(*) FILTER (WHERE role = 'COORDINATOR' AND status = 'DISABLED')::int AS coordinators_disabled,
             count(*) FILTER (WHERE role = 'COORDINATOR' AND status = 'ACTIVE' AND NOT EXISTS (SELECT 1 FROM coordinator_assignments a WHERE a.user_id = users.id AND a.ended_at IS NULL))::int AS unassigned
      FROM users WHERE role IN ('PLACEMENT_OFFICER', 'COORDINATOR')`.execute(t)).rows[0];
    const pending = n((await sql<{ n: number }>`SELECT count(*)::int AS n FROM invitations WHERE role IN ('PLACEMENT_OFFICER', 'COORDINATOR') AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()`.execute(t)).rows[0].n);
    const stu = (await sql<{ total: number; not_invited: number; invited: number; active: number; disabled: number }>`
      SELECT count(*)::int AS total,
             count(*) FILTER (WHERE x.st = 'NOT_INVITED')::int AS not_invited, count(*) FILTER (WHERE x.st = 'INVITED')::int AS invited,
             count(*) FILTER (WHERE x.st = 'ACTIVE')::int AS active, count(*) FILTER (WHERE x.st = 'DISABLED')::int AS disabled
      FROM (SELECT CASE WHEN u.status = 'DISABLED' THEN 'DISABLED' WHEN s.user_id IS NOT NULL THEN 'ACTIVE'
                        WHEN EXISTS (SELECT 1 FROM invitations i WHERE i.student_id = s.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN 'INVITED'
                        ELSE 'NOT_INVITED' END AS st
              FROM students s LEFT JOIN users u ON u.id = s.user_id) x`.execute(t)).rows[0];
    const ac = (await sql<{ verified: number; pending: number; rejected: number; not_submitted: number }>`
      SELECT count(*) FILTER (WHERE status = 'VERIFIED')::int AS verified, count(*) FILTER (WHERE status = 'PENDING')::int AS pending,
             count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected, count(*) FILTER (WHERE status = 'NOT_SUBMITTED')::int AS not_submitted FROM student_academic_status`.execute(t)).rows[0];
    const college = (await sql<{ name: string }>`SELECT name FROM colleges`.execute(t)).rows[0];
    const recent = (await sql<{ id: string; occurred_at: Date; action: string; actor_email: string | null }>`
      SELECT a.id::text, a.occurred_at, a.action, u.email::text AS actor_email FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.scope = 'COLLEGE' AND a.action NOT IN ('LOGIN_SUCCEEDED', 'LOGIN_FAILED', 'LOGOUT') ORDER BY a.id DESC LIMIT 6`.execute(t)).rows;
    return { dep, staff, pending, college, recent, stu, ac };
  });
}

export async function listCollegeAudit(s: SessionUser, f: { action?: string; page: number }) {
  return withSession(s, async (t) => {
    const actions = (await sql<{ action: string }>`SELECT DISTINCT action FROM audit_log WHERE scope = 'COLLEGE' ORDER BY action`.execute(t)).rows.map((r) => r.action);
    const c: RawBuilder<unknown>[] = [sql`a.scope = 'COLLEGE'`];
    if (f.action && actions.includes(f.action)) c.push(sql`a.action = ${f.action}`);
    const w = where(c);
    const total = n((await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_log a ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<{ id: string; occurred_at: Date; action: string; actor_email: string | null; entity_type: string | null; entity_id: string | null; metadata: Record<string, unknown> }>`
      SELECT a.id::text, a.occurred_at, a.action, u.email::text AS actor_email, a.entity_type, a.entity_id, a.metadata
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id ${w} ORDER BY a.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    return { rows, total, actions };
  });
}

export async function myDepartments(s: SessionUser) {
  return withSession(s, async (t) =>
    (await sql<{ id: string; name: string; code: string; status: string; students: number }>`
      SELECT d.id, d.name::text AS name, d.code::text AS code, d.status, (SELECT count(*)::int FROM students st WHERE st.department_id = d.id) AS students
      FROM departments d ORDER BY d.code`.execute(t)).rows,
  );
}

/** Students per department split by academic verification (for the dashboard chart). RLS keeps it to the caller's college (and, for a coordinator, their departments). */
export async function studentsByDepartment(s: SessionUser) {
  return withSession(s, async (t) => (await sql<{ code: string; total: number; verified: number; pending: number }>`
    SELECT d.code::text AS code, count(a.student_id)::int AS total, count(*) FILTER (WHERE a.status = 'VERIFIED')::int AS verified, count(*) FILTER (WHERE a.status = 'PENDING')::int AS pending
      FROM departments d LEFT JOIN student_academic_status a ON a.department_id = d.id WHERE d.status = 'ACTIVE' GROUP BY d.code ORDER BY d.code`.execute(t)).rows);
}

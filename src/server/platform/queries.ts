import { sql, type RawBuilder } from "kysely";
import { PAGE_SIZE } from "@/components/ui/pagination";
import { likePattern } from "@/lib/validation";
import { withSession, type SessionUser } from "../auth/session";

// All reads run as the signed-in platform admin, under RLS (see db/migrations/0003_onboarding.sql).

const where = (conds: RawBuilder<unknown>[]) => (conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``);
const num = (v: unknown) => Number(v ?? 0);

export const APPLICATION_STATUSES = ["SUBMITTED", "UNDER_REVIEW", "APPROVED", "REJECTED"] as const;

export type ApplicationRow = { id: string; name: string; state: string; district: string; status: string; submitted_at: Date };

export async function listApplications(s: SessionUser, f: { status?: string; q?: string; page: number }) {
  return withSession(s, async (t) => {
    const conds: RawBuilder<unknown>[] = [];
    if (f.status && (APPLICATION_STATUSES as readonly string[]).includes(f.status)) conds.push(sql`status = ${f.status}`);
    if (f.q) conds.push(sql`(name ILIKE ${likePattern(f.q)} ESCAPE '\\' OR official_email::text ILIKE ${likePattern(f.q)} ESCAPE '\\' OR district ILIKE ${likePattern(f.q)} ESCAPE '\\')`);
    const w = where(conds);
    const total = num((await sql<{ n: number }>`SELECT count(*)::int AS n FROM college_applications ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<ApplicationRow>`SELECT id, name, state, district, status, submitted_at FROM college_applications ${w}
      ORDER BY submitted_at DESC, id LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    const counts = Object.fromEntries((await sql<{ status: string; n: number }>`SELECT status, count(*)::int AS n FROM college_applications GROUP BY status`.execute(t)).rows.map((r) => [r.status, r.n]));
    return { rows, total, counts: counts as Record<string, number> };
  });
}

export type ApplicationDetail = {
  id: string; status: string; name: string; official_email: string; address: string; state: string; district: string; website: string;
  contact_person: string; phone: string; college_type: string; approx_students: number; submitted_at: Date; review_started_at: Date | null;
  decided_at: Date | null; decision_reason: string | null; college_id: string | null; reviewer_email: string | null;
};

export async function getApplication(s: SessionUser, id: string) {
  return withSession(s, async (t) =>
    (await sql<ApplicationDetail>`SELECT a.id, a.status, a.name, a.official_email, a.address, a.state, a.district, a.website, a.contact_person, a.phone,
      a.college_type, a.approx_students, a.submitted_at, a.review_started_at, a.decided_at, a.decision_reason, a.college_id, u.email AS reviewer_email
      FROM college_applications a LEFT JOIN users u ON u.id = a.reviewed_by WHERE a.id = ${id}`.execute(t)).rows[0] ?? null,
  );
}

export type CollegeRow = { id: string; name: string; state: string | null; district: string | null; status: string; commercial_status: string; created_at: Date; admin_state: string; pending_until: Date | null };

export async function listColleges(s: SessionUser, f: { access?: string; commercial?: string; q?: string; page: number }) {
  return withSession(s, async (t) => {
    const conds: RawBuilder<unknown>[] = [];
    if (f.access === "ACTIVE" || f.access === "SUSPENDED") conds.push(sql`c.status = ${f.access}`);
    if (f.commercial && ["NOT_STARTED", "PENDING", "ACTIVE", "EXPIRED", "SUSPENDED"].includes(f.commercial)) conds.push(sql`c.commercial_status = ${f.commercial}`);
    if (f.q) conds.push(sql`(c.name ILIKE ${likePattern(f.q)} ESCAPE '\\' OR c.district ILIKE ${likePattern(f.q)} ESCAPE '\\' OR c.state ILIKE ${likePattern(f.q)} ESCAPE '\\')`);
    const w = where(conds);
    const total = num((await sql<{ n: number }>`SELECT count(*)::int AS n FROM colleges c ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<CollegeRow>`
      SELECT c.id, c.name, c.state, c.district, c.status, c.commercial_status, c.created_at,
        CASE WHEN EXISTS (SELECT 1 FROM users u WHERE u.college_id = c.id AND u.role = 'COLLEGE_ADMIN' AND u.status = 'ACTIVE') THEN 'ACTIVE'
             WHEN pend.until IS NOT NULL THEN 'INVITED' ELSE 'NO_INVITATION' END AS admin_state,
        pend.until AS pending_until
      FROM colleges c
      LEFT JOIN LATERAL (SELECT max(i.expires_at) AS until FROM invitations i
         WHERE i.college_id = c.id AND i.role = 'COLLEGE_ADMIN' AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) pend ON true
      ${w} ORDER BY c.created_at DESC, c.id LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    return { rows, total };
  });
}

export type CollegeDetail = {
  id: string; name: string; status: string; commercial_status: string; commercial_updated_at: Date | null; created_at: Date; suspended_at: Date | null;
  official_email: string | null; address: string | null; state: string | null; district: string | null; website: string | null; college_type: string | null;
  contact_person: string | null; contact_phone: string | null; approx_students: number | null; application_id: string | null;
};

export async function getCollege(s: SessionUser, id: string) {
  return withSession(s, async (t) => {
    const college = (await sql<CollegeDetail>`SELECT id, name, status, commercial_status, commercial_updated_at, created_at, suspended_at, official_email, address,
      state, district, website, college_type, contact_person, contact_phone, approx_students, application_id FROM colleges WHERE id = ${id}`.execute(t)).rows[0];
    if (!college) return null;
    const internal = (await sql<{ commercial_note: string | null; suspended_reason: string | null }>`SELECT * FROM platform.college_internal(${id}::uuid)`.execute(t)).rows[0];
    const admins = (await sql<{ id: string; full_name: string; email: string; status: string; last_login_at: Date | null }>`
      SELECT id, full_name, email, status, last_login_at FROM users WHERE college_id = ${id} AND role = 'COLLEGE_ADMIN' ORDER BY created_at`.execute(t)).rows;
    const invitations = (await sql<{ id: string; email: string; expires_at: Date; created_at: Date }>`
      SELECT id, email, expires_at, created_at FROM invitations WHERE college_id = ${id} AND role = 'COLLEGE_ADMIN'
        AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`.execute(t)).rows;
    return { college, internal, admins, invitations };
  });
}

export async function listInquiries(s: SessionUser, f: { status?: string; page: number }) {
  return withSession(s, async (t) => {
    const conds: RawBuilder<unknown>[] = [];
    if (f.status === "NEW" || f.status === "HANDLED") conds.push(sql`status = ${f.status}`);
    const w = where(conds);
    const total = num((await sql<{ n: number }>`SELECT count(*)::int AS n FROM contact_inquiries ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<{ id: string; name: string; email: string; organization: string | null; message: string; status: string; created_at: Date }>`
      SELECT id, name, email, organization, message, status, created_at FROM contact_inquiries ${w} ORDER BY created_at DESC, id LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    return { rows, total };
  });
}

export async function listAudit(s: SessionUser, f: { action?: string; page: number }) {
  return withSession(s, async (t) => {
    const actions = (await sql<{ action: string }>`SELECT DISTINCT action FROM audit_log WHERE scope = 'PLATFORM' ORDER BY action`.execute(t)).rows.map((r) => r.action);
    const conds: RawBuilder<unknown>[] = [sql`a.scope = 'PLATFORM'`];
    if (f.action && actions.includes(f.action)) conds.push(sql`a.action = ${f.action}`);
    const w = where(conds);
    const total = num((await sql<{ n: number }>`SELECT count(*)::int AS n FROM audit_log a ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<{ id: string; occurred_at: Date; action: string; actor_email: string | null; entity_type: string | null; entity_id: string | null; metadata: Record<string, unknown> }>`
      SELECT a.id::text, a.occurred_at, a.action, u.email AS actor_email, a.entity_type, a.entity_id, a.metadata
      FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id ${w}
      ORDER BY a.id DESC LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    return { rows, total, actions };
  });
}

export async function overview(s: SessionUser) {
  return withSession(s, async (t) => {
    const one = async <T extends object>(q: ReturnType<typeof sql<T>>) => (await q.execute(t)).rows[0];
    const apps = await one(sql<{ submitted: number; under_review: number; approved: number; rejected: number }>`
      SELECT count(*) FILTER (WHERE status = 'SUBMITTED')::int AS submitted, count(*) FILTER (WHERE status = 'UNDER_REVIEW')::int AS under_review,
             count(*) FILTER (WHERE status = 'APPROVED')::int AS approved, count(*) FILTER (WHERE status = 'REJECTED')::int AS rejected FROM college_applications`);
    const cols = await one(sql<{ total: number; active: number; suspended: number; not_started: number; pending: number; commercial_active: number; expired: number; commercial_suspended: number }>`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE status = 'ACTIVE')::int AS active, count(*) FILTER (WHERE status = 'SUSPENDED')::int AS suspended,
             count(*) FILTER (WHERE commercial_status = 'NOT_STARTED')::int AS not_started, count(*) FILTER (WHERE commercial_status = 'PENDING')::int AS pending,
             count(*) FILTER (WHERE commercial_status = 'ACTIVE')::int AS commercial_active, count(*) FILTER (WHERE commercial_status = 'EXPIRED')::int AS expired,
             count(*) FILTER (WHERE commercial_status = 'SUSPENDED')::int AS commercial_suspended FROM colleges`);
    const noAdmin = await one(sql<{ n: number }>`SELECT count(*)::int AS n FROM colleges c WHERE c.status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM users u WHERE u.college_id = c.id AND u.role = 'COLLEGE_ADMIN' AND u.status = 'ACTIVE')`);
    const inq = await one(sql<{ n: number }>`SELECT count(*)::int AS n FROM contact_inquiries WHERE status = 'NEW'`);
    const recent = (await sql<{ id: string; occurred_at: Date; action: string; actor_email: string | null }>`
      SELECT a.id::text, a.occurred_at, a.action, u.email AS actor_email FROM audit_log a LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.scope = 'PLATFORM' ORDER BY a.id DESC LIMIT 6`.execute(t)).rows;
    return { apps, cols, collegesWithoutAdmin: noAdmin.n, newInquiries: inq.n, recent };
  });
}

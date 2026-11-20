import { sql, type RawBuilder } from "kysely";
import { PAGE_SIZE } from "@/components/ui/pagination";
import { likePattern, uuidSchema } from "@/lib/validation";
import { withSession, type SessionUser } from "../auth/session";

// Officers and admins see every drive of their college; students and coordinators only PUBLISHED/CLOSED ones (RLS).
const n = (v: unknown) => Number(v ?? 0);

export type DriveRow = { id: string; company_name: string; job_title: string; employment_type: string; status: string; application_deadline: Date | null; openings: number | null; updated_at: Date };

export async function listDrives(s: SessionUser, f: { q?: string; status?: string; company?: string; page: number }) {
  return withSession(s, async (t) => {
    const c: RawBuilder<unknown>[] = [];
    if (["DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"].includes(f.status ?? "")) c.push(sql`d.status = ${f.status}`);
    if (f.company && uuidSchema.safeParse(f.company).success) c.push(sql`d.company_id = ${f.company}::uuid`);
    if (f.q) c.push(sql`(d.job_title ILIKE ${likePattern(f.q)} ESCAPE '\\' OR d.company_name ILIKE ${likePattern(f.q)} ESCAPE '\\' OR d.location ILIKE ${likePattern(f.q)} ESCAPE '\\')`);
    const w = c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``;
    const total = n((await sql<{ n: number }>`SELECT count(*)::int AS n FROM drives d ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<DriveRow>`SELECT d.id, d.company_name, d.job_title, d.employment_type, d.status, d.application_deadline, d.openings, d.updated_at FROM drives d ${w} ORDER BY d.created_at DESC, d.id LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    const counts = Object.fromEntries((await sql<{ status: string; n: number }>`SELECT status, count(*)::int AS n FROM drives GROUP BY status`.execute(t)).rows.map((r) => [r.status, r.n])) as Record<string, number>;
    return { rows, total, counts };
  });
}

export type DriveDetail = {
  id: string; company_id: string; company_name: string; job_title: string; job_description: string | null; location: string | null; employment_type: string; ctc_lpa: string | null; ctc_note: string | null;
  bond_details: string | null; qualification: string | null; openings: number | null; application_deadline: Date | null; interview_details: string | null; instructions: string | null; status: string;
  created_at: Date; published_at: Date | null; closed_at: Date | null;
  registration_method: string; external_url: string | null; external_instructions: string | null; external_url_confirmed: boolean; evidence_review_required: boolean;
};
export type Criteria = { min_cgpa: string | null; min_tenth: string | null; min_twelfth: string | null; min_diploma: string | null; max_active_backlogs: number | null; max_historical_arrears: number | null; passing_years: number[]; degrees: string[] };

export async function getDrive(s: SessionUser, id: string) {
  return withSession(s, async (t) => {
    const drive = (await sql<DriveDetail>`SELECT id, company_id, company_name, job_title, job_description, location, employment_type, ctc_lpa::text AS ctc_lpa, ctc_note, bond_details, qualification, openings, application_deadline,
      interview_details, instructions, status, created_at, published_at, closed_at,
      registration_method, external_url, external_instructions, external_url_confirmed, evidence_review_required FROM drives WHERE id = ${id}`.execute(t)).rows[0];
    if (!drive) return null;
    const criteria = (await sql<Criteria>`SELECT min_cgpa::text AS min_cgpa, min_tenth::text AS min_tenth, min_twelfth::text AS min_twelfth, min_diploma::text AS min_diploma, max_active_backlogs, max_historical_arrears, passing_years, degrees FROM drive_criteria WHERE drive_id = ${id}`.execute(t)).rows[0];
    const departments = (await sql<{ id: string; code: string; name: string }>`SELECT dp.id, dp.code::text AS code, dp.name::text AS name FROM drive_departments dd JOIN departments dp ON dp.id = dd.department_id WHERE dd.drive_id = ${id} ORDER BY dp.code`.execute(t)).rows;
    return { drive, criteria, departments };
  });
}

export async function driveEvents(s: SessionUser, id: string) {
  return withSession(s, async (t) => (await sql<{ event: string; actor_name: string; occurred_at: Date }>`SELECT event, actor_name, occurred_at FROM drive_events WHERE drive_id = ${id} ORDER BY id DESC`.execute(t)).rows);
}

export async function driveFormOptions(s: SessionUser) {
  return withSession(s, async (t) => ({
    companies: (await sql<{ id: string; name: string }>`SELECT id, name::text AS name FROM companies WHERE status = 'ACTIVE' ORDER BY name`.execute(t)).rows,
    departments: (await sql<{ id: string; code: string; name: string }>`SELECT id, code::text AS code, name::text AS name FROM departments WHERE status = 'ACTIVE' ORDER BY code`.execute(t)).rows,
  }));
}

export async function drivesOfCompany(s: SessionUser, companyId: string) {
  return withSession(s, async (t) => (await sql<DriveRow>`SELECT d.id, d.company_name, d.job_title, d.employment_type, d.status, d.application_deadline, d.openings, d.updated_at FROM drives d WHERE d.company_id = ${companyId} ORDER BY d.created_at DESC`.execute(t)).rows);
}

export async function driveStats(s: SessionUser) {
  return withSession(s, async (t) => (await sql<{ draft: number; published: number; closed: number; archived: number }>`
    SELECT count(*) FILTER (WHERE status = 'DRAFT')::int AS draft, count(*) FILTER (WHERE status = 'PUBLISHED')::int AS published, count(*) FILTER (WHERE status = 'CLOSED')::int AS closed, count(*) FILTER (WHERE status = 'ARCHIVED')::int AS archived FROM drives`.execute(t)).rows[0]);
}

/** Published drives whose application deadline is within the next 7 days (staff dashboards). */
export async function closingSoon(s: SessionUser) {
  return withSession(s, async (t) => (await sql<{ id: string; job_title: string; company_name: string; application_deadline: Date }>`
    SELECT id, job_title, company_name, application_deadline FROM drives WHERE status = 'PUBLISHED' AND application_deadline > now() AND application_deadline < now() + interval '7 days' ORDER BY application_deadline LIMIT 5`.execute(t)).rows);
}

/** Registrations per published drive (for the officer dashboard chart). Counted once per student; a screenshot upload is not a registration. */
export async function openDriveRegistrations(s: SessionUser) {
  return withSession(s, async (t) => (await sql<{ id: string; company_name: string; job_title: string; openings: number | null; registered: number; started: number }>`
    SELECT d.id, d.company_name, d.job_title, d.openings, count(r.id) FILTER (WHERE r.status = 'REGISTERED')::int AS registered, count(r.id) FILTER (WHERE r.status = 'PENDING_EXTERNAL')::int AS started
      FROM drives d LEFT JOIN registrations r ON r.drive_id = d.id WHERE d.status = 'PUBLISHED' GROUP BY d.id ORDER BY d.application_deadline NULLS LAST, d.id LIMIT 8`.execute(t)).rows);
}

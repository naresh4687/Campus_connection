import { sql } from "kysely";
import type { Check } from "@/lib/eligibility";
import type { PartRow } from "@/lib/participation";
import { withSession, type SessionUser } from "../auth/session";

export type MyRegistration = { id: string; status: string; registered_at: Date; method: string; evidence_status: string | null; external_url: string | null; late_ok_until: Date | null };
export type MyDriveRow = { id: string; company_name: string; job_title: string; employment_type: string; status: string; application_deadline: Date | null; result: string; registration_status: string | null; method: string | null; evidence_status: string | null };

/** Every drive the student can see, with their own engine result and registration status (computed live from verified data). */
export async function myDrives(s: SessionUser) {
  return withSession(s, async (t) => (await sql<MyDriveRow>`
    SELECT d.id, d.company_name, d.job_title, d.employment_type, d.status, d.application_deadline, m.result, m.registration_status, r.method, r.evidence_status
      FROM eligibility.my_drives() m JOIN drives d ON d.id = m.drive_id LEFT JOIN registrations r ON r.drive_id = d.id AND r.status <> 'WITHDRAWN'
     ORDER BY (d.status = 'PUBLISHED') DESC, d.application_deadline NULLS LAST, d.id`.execute(t)).rows);
}

/** Runs the engine for the caller against one drive (records a snapshot only when the outcome changed) and returns the per-criterion reasons. */
export async function myEligibility(s: SessionUser, driveId: string) {
  return withSession(s, async (t) => {
    const r = (await sql<{ r: { result: string; checks: Check[] } }>`SELECT eligibility.check_drive(${driveId}::uuid) AS r`.execute(t)).rows[0].r;
    const reg = (await sql<MyRegistration>`SELECT id, status, registered_at, method, evidence_status, external_url, late_ok_until FROM registrations WHERE drive_id = ${driveId}`.execute(t)).rows[0] ?? null;
    return { result: r.result, checks: r.checks, registration: reg };
  });
}

export type DriveCounts = { eligible: number; needs_data: number; not_eligible: number; registered: number; withdrawn: number };
export async function driveCounts(s: SessionUser, driveId: string) {
  return withSession(s, async (t) => (await sql<DriveCounts>`SELECT * FROM eligibility.drive_counts(${driveId}::uuid)`.execute(t)).rows[0]);
}

export type Applicant = {
  student_id: string; full_name: string; register_number: string; department_code: string; degree: string; passing_year: number; contact_email: string | null; phone: string | null;
  cgpa: string | null; tenth: string | null; twelfth: string | null; diploma: string | null; active_backlogs: number | null; historical_arrears: number | null; registered_at: Date; resume_id: string | null; method?: string; evidence_status?: string | null;
  github_url?: string | null; leetcode_url?: string | null; linkedin_url?: string | null;
};
export async function applicants(s: SessionUser, driveId: string) {
  return withSession(s, async (t) => {
    const rows = (await sql<Applicant & { college_email: string | null }>`SELECT * FROM registrations.list_for_drive(${driveId}::uuid)`.execute(t)).rows
      .map(({ college_email, ...r }) => ({ ...r, contact_email: college_email }));   // the personal email (migration 0049)
    const how = new Map((await sql<{ student_id: string; method: string; evidence_status: string | null }>`SELECT student_id, method, evidence_status FROM registrations WHERE drive_id = ${driveId}::uuid`.execute(t)).rows.map((r) => [r.student_id, r]));
    const links = new Map((await sql<{ id: string; github_url: string | null; leetcode_url: string | null; linkedin_url: string | null }>`SELECT id, github_url, leetcode_url, linkedin_url FROM students WHERE id = ANY (${rows.map((r) => r.student_id)}::uuid[])`.execute(t)).rows.map((r) => [r.id, r]));
    return rows.map((r) => ({ ...r, method: how.get(r.student_id)?.method ?? "INTERNAL", evidence_status: how.get(r.student_id)?.evidence_status ?? null,
      github_url: links.get(r.student_id)?.github_url ?? null, leetcode_url: links.get(r.student_id)?.leetcode_url ?? null, linkedin_url: links.get(r.student_id)?.linkedin_url ?? null }));
  });
}

/** Coordinator dashboard: registrations of the students in the coordinator's departments (RLS does the scoping; there is no WHERE on purpose). */
export async function deptParticipation(s: SessionUser) {
  return withSession(s, async (t) => (await sql<{ registrations: number; students: number; drives: number }>`
    SELECT count(*) FILTER (WHERE status = 'REGISTERED')::int AS registrations, count(DISTINCT student_id) FILTER (WHERE status = 'REGISTERED')::int AS students, count(DISTINCT drive_id) FILTER (WHERE status = 'REGISTERED')::int AS drives FROM registrations`.execute(t)).rows[0]);
}

// ───────────── external registration evidence ─────────────
export type EvidenceVersion = { id: string; version: number; status: string; original_name: string; size_bytes: number; submitted_at: Date; reviewed_by_name: string | null; reviewed_at: Date | null; review_note: string | null };
export const evidenceHistory = (s: SessionUser, registrationId: string) => withSession(s, async (t) => (await sql<EvidenceVersion>`SELECT * FROM registrations.evidence_history(${registrationId}::uuid)`.execute(t)).rows);


export type DriveEvidenceRow = { registration_id: string; student_id: string; evidence_status: string | null; evidence_id: string | null; version: number | null; submitted_at: Date | null; review_note: string | null; reviewed_by_name: string | null; versions: number };
/** Staff: the latest screenshot of each external registration in one drive that the caller may review, keyed by student (for the registered-students tables). */
export const driveEvidence = (s: SessionUser, driveId: string) => withSession(s, async (t) =>
  new Map((await sql<DriveEvidenceRow>`SELECT * FROM registrations.evidence_queue(${driveId}::uuid)`.execute(t)).rows.map((r) => [r.student_id, r] as const)));

export type ExternalCounts = { internal_registered: number; external_started: number; screenshots_submitted: number; pending_review: number; verified: number; rejected: number; action_required: number };
export const externalCounts = (s: SessionUser, driveId: string) => withSession(s, async (t) => (await sql<ExternalCounts>`SELECT * FROM registrations.external_counts(${driveId}::uuid)`.execute(t)).rows[0]);

/** Every student of the drive's departments the caller may see (a coordinator: their own), with the engine's eligibility result and the registration status. */
export async function participation(s: SessionUser, driveId: string, dept: string | null) {
  return withSession(s, async (t) => (await sql<PartRow & { college_email: string | null }>`SELECT * FROM registrations.participation(${driveId}::uuid, ${dept}::uuid)`.execute(t)).rows
    .map(({ college_email, ...r }) => ({ ...r, contact_email: college_email })));   // the personal email (migration 0049)
}
export const logParticipationExport = (s: SessionUser, driveId: string, view: string, rows: number) =>
  withSession(s, (t) => sql`SELECT registrations.log_participation_export(${driveId}::uuid, ${view}, ${rows}::int)`.execute(t));

/** Completed registrations per day for the last N days (including days with none), for the dashboard trend line. RLS scopes it: an officer sees the college, a coordinator their students. */
export async function registrationsPerDay(s: SessionUser, days = 14) {
  return withSession(s, async (t) => (await sql<{ day: string; n: number }>`
    SELECT to_char(g.d, 'YYYY-MM-DD') AS day, count(r.id)::int AS n
      FROM generate_series((now() AT TIME ZONE 'Asia/Kolkata')::date - ${days - 1}::int, (now() AT TIME ZONE 'Asia/Kolkata')::date, interval '1 day') AS g(d)
      LEFT JOIN registrations r ON r.status = 'REGISTERED' AND (r.registered_at AT TIME ZONE 'Asia/Kolkata')::date = g.d::date
     GROUP BY g.d ORDER BY g.d`.execute(t)).rows);
}

export type RecentRegistration = { name: string; dept: string; job: string; company: string; at: Date; method: string; evidence_status: string | null };
/** The latest completed registrations (officer: the college; coordinator: their departments, through row-level security). */
export async function recentRegistrations(s: SessionUser, limit = 5) {
  return withSession(s, async (t) => (await sql<RecentRegistration>`
    SELECT st.full_name AS name, dp.code::text AS dept, d.job_title AS job, d.company_name AS company, r.registered_at AS at, r.method, r.evidence_status
      FROM registrations r JOIN students st ON st.id = r.student_id JOIN departments dp ON dp.id = st.department_id JOIN drives d ON d.id = r.drive_id
     WHERE r.status = 'REGISTERED' ORDER BY r.registered_at DESC LIMIT ${limit}`.execute(t)).rows);
}

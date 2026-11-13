import { sql } from "kysely";
import type { Check } from "@/lib/eligibility";
import { withSession, type SessionUser } from "../auth/session";

export type MyDriveRow = { id: string; company_name: string; job_title: string; employment_type: string; status: string; application_deadline: Date | null; result: string; registration_status: string | null };

/** Every drive the student can see, with their own engine result and registration status (computed live from verified data). */
export async function myDrives(s: SessionUser) {
  return withSession(s, async (t) => (await sql<MyDriveRow>`
    SELECT d.id, d.company_name, d.job_title, d.employment_type, d.status, d.application_deadline, m.result, m.registration_status
      FROM eligibility.my_drives() m JOIN drives d ON d.id = m.drive_id
     ORDER BY (d.status = 'PUBLISHED') DESC, d.application_deadline NULLS LAST, d.id`.execute(t)).rows);
}

/** Runs the engine for the caller against one drive (records a snapshot only when the outcome changed) and returns the per-criterion reasons. */
export async function myEligibility(s: SessionUser, driveId: string) {
  return withSession(s, async (t) => {
    const r = (await sql<{ r: { result: string; checks: Check[] } }>`SELECT eligibility.check_drive(${driveId}::uuid) AS r`.execute(t)).rows[0].r;
    const reg = (await sql<{ status: string; registered_at: Date }>`SELECT status, registered_at FROM registrations WHERE drive_id = ${driveId}`.execute(t)).rows[0] ?? null;
    return { result: r.result, checks: r.checks, registration: reg };
  });
}

export type DriveCounts = { eligible: number; needs_data: number; not_eligible: number; registered: number; withdrawn: number };
export async function driveCounts(s: SessionUser, driveId: string) {
  return withSession(s, async (t) => (await sql<DriveCounts>`SELECT * FROM eligibility.drive_counts(${driveId}::uuid)`.execute(t)).rows[0]);
}

export type Applicant = {
  student_id: string; full_name: string; register_number: string; department_code: string; degree: string; passing_year: number; college_email: string; phone: string | null;
  cgpa: string | null; tenth: string | null; twelfth: string | null; diploma: string | null; active_backlogs: number | null; historical_arrears: number | null; registered_at: Date; resume_id: string | null;
};
export async function applicants(s: SessionUser, driveId: string) {
  return withSession(s, async (t) => (await sql<Applicant>`SELECT * FROM registrations.list_for_drive(${driveId}::uuid)`.execute(t)).rows);
}

/** Coordinator dashboard: registrations of the students in the coordinator's departments (RLS does the scoping; there is no WHERE on purpose). */
export async function deptParticipation(s: SessionUser) {
  return withSession(s, async (t) => (await sql<{ registrations: number; students: number; drives: number }>`
    SELECT count(*) FILTER (WHERE status = 'REGISTERED')::int AS registrations, count(DISTINCT student_id) FILTER (WHERE status = 'REGISTERED')::int AS students, count(DISTINCT drive_id) FILTER (WHERE status = 'REGISTERED')::int AS drives FROM registrations`.execute(t)).rows[0]);
}

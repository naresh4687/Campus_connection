import { sql, type RawBuilder } from "kysely";
import { PAGE_SIZE } from "@/components/ui/pagination";
import { likePattern, uuidSchema } from "@/lib/validation";
import { withSession, type SessionUser } from "../auth/session";

// All reads run as the signed-in user under RLS: a student sees their own submissions, a coordinator those of students in their
// assigned departments, an admin all of the college. Nothing here filters by college or department itself.
const n = (v: unknown) => Number(v ?? 0);
const where = (c: RawBuilder<unknown>[]) => (c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``);

export type Submission = {
  id: string; student_id: string; version: number; status: string; cgpa: string; tenth_percentage: string; twelfth_percentage: string | null; diploma_percentage: string | null;
  active_backlogs: number; historical_arrears: number; student_note: string | null; degree: string; passing_year: number; submitted_at: Date;
  reviewed_by_name: string | null; reviewed_at: Date | null; review_note: string | null; rejection_reason: string | null;
  semesters: { semester: number; sgpa: string; backlogs: number }[];
};
const COLS = sql`a.id, a.student_id, a.version, a.status, a.cgpa::text AS cgpa, a.tenth_percentage::text AS tenth_percentage, a.twelfth_percentage::text AS twelfth_percentage,
  a.diploma_percentage::text AS diploma_percentage, a.active_backlogs, a.historical_arrears, a.student_note, a.degree, a.passing_year, a.submitted_at, a.reviewed_by_name, a.reviewed_at, a.review_note, a.rejection_reason,
  (SELECT coalesce(json_agg(json_build_object('semester', r.semester, 'sgpa', r.sgpa::text, 'backlogs', r.backlogs) ORDER BY r.semester), '[]'::json) FROM semester_results r WHERE r.submission_id = a.id) AS semesters`;

/** All submissions of one student, newest first (their own, or one the viewer is allowed to see). */
export async function submissionsFor(s: SessionUser, studentId: string) {
  return withSession(s, async (t) => (await sql<Submission>`SELECT ${COLS} FROM academic_submissions a WHERE a.student_id = ${studentId} ORDER BY a.version DESC`.execute(t)).rows);
}

export async function mySubmissions(s: SessionUser) {
  return withSession(s, async (t) => (await sql<Submission>`SELECT ${COLS} FROM academic_submissions a ORDER BY a.version DESC`.execute(t)).rows);
}

export type QueueRow = { id: string; student_id: string; version: number; submitted_at: Date; full_name: string; register_number: string; dept_code: string; update_of_verified: boolean; status: string; reviewed_at: Date | null; reviewed_by_name: string | null };

export async function reviewQueue(s: SessionUser, f: { dept?: string; q?: string; page: number }) {
  return withSession(s, async (t) => {
    const c: RawBuilder<unknown>[] = [sql`a.status = 'SUBMITTED'`];
    if (f.dept && uuidSchema.safeParse(f.dept).success) c.push(sql`st.department_id = ${f.dept}::uuid`);
    if (f.q) c.push(sql`(st.full_name ILIKE ${likePattern(f.q)} ESCAPE '\\' OR st.register_number::text ILIKE ${likePattern(f.q)} ESCAPE '\\')`);
    const w = where(c);
    const total = n((await sql<{ n: number }>`SELECT count(*)::int AS n FROM academic_submissions a JOIN students st ON st.id = a.student_id ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<QueueRow>`
      SELECT a.id, a.student_id, a.version, a.submitted_at, a.status, a.reviewed_at, a.reviewed_by_name, st.full_name, st.register_number::text AS register_number, d.code::text AS dept_code,
             EXISTS (SELECT 1 FROM academic_submissions v WHERE v.student_id = a.student_id AND v.status = 'VERIFIED') AS update_of_verified
      FROM academic_submissions a JOIN students st ON st.id = a.student_id JOIN departments d ON d.id = st.department_id ${w}
      ORDER BY a.submitted_at ASC, a.id LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    const depts = (await sql<{ id: string; code: string }>`SELECT id, code::text AS code FROM departments ORDER BY code`.execute(t)).rows;
    return { rows, total, depts };
  });
}

export async function decisionHistory(s: SessionUser, f: { status?: string; dept?: string; q?: string; page: number }) {
  return withSession(s, async (t) => {
    const c: RawBuilder<unknown>[] = [sql`a.status IN ('VERIFIED', 'REJECTED', 'SUPERSEDED')`];
    if (f.status && ["VERIFIED", "REJECTED", "SUPERSEDED"].includes(f.status)) c.push(sql`a.status = ${f.status}`);
    if (f.dept && uuidSchema.safeParse(f.dept).success) c.push(sql`st.department_id = ${f.dept}::uuid`);
    if (f.q) c.push(sql`(st.full_name ILIKE ${likePattern(f.q)} ESCAPE '\\' OR st.register_number::text ILIKE ${likePattern(f.q)} ESCAPE '\\')`);
    const w = where(c);
    const total = n((await sql<{ n: number }>`SELECT count(*)::int AS n FROM academic_submissions a JOIN students st ON st.id = a.student_id ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<QueueRow>`
      SELECT a.id, a.student_id, a.version, a.submitted_at, a.status, a.reviewed_at, a.reviewed_by_name, st.full_name, st.register_number::text AS register_number, d.code::text AS dept_code, false AS update_of_verified
      FROM academic_submissions a JOIN students st ON st.id = a.student_id JOIN departments d ON d.id = st.department_id ${w}
      ORDER BY a.reviewed_at DESC NULLS LAST, a.id LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    const depts = (await sql<{ id: string; code: string }>`SELECT id, code::text AS code FROM departments ORDER BY code`.execute(t)).rows;
    return { rows, total, depts };
  });
}

export type ReviewDetail = { submission: Submission; student: { id: string; full_name: string; register_number: string; dept_code: string; dept_name: string; degree: string; passing_year: number; admission_year: number; college_email: string }; others: Submission[] };

export async function getSubmission(s: SessionUser, id: string): Promise<ReviewDetail | null> {
  return withSession(s, async (t) => {
    const submission = (await sql<Submission>`SELECT ${COLS} FROM academic_submissions a WHERE a.id = ${id}`.execute(t)).rows[0];
    if (!submission) return null;
    const student = (await sql<ReviewDetail["student"]>`
      SELECT st.id, st.full_name, st.register_number::text AS register_number, d.code::text AS dept_code, d.name::text AS dept_name, st.degree, st.passing_year, st.admission_year, st.college_email::text AS college_email
      FROM students st JOIN departments d ON d.id = st.department_id WHERE st.id = ${submission.student_id}`.execute(t)).rows[0];
    const others = (await sql<Submission>`SELECT ${COLS} FROM academic_submissions a WHERE a.student_id = ${submission.student_id} AND a.id <> ${id} ORDER BY a.version DESC`.execute(t)).rows;
    return student ? { submission, student, others } : null;
  });
}

/** Per-department counts of students by academic status (admins see all departments, coordinators their own). */
export async function academicsByDepartment(s: SessionUser) {
  return withSession(s, async (t) => {
    const rows = (await sql<{ id: string; code: string; name: string; status: string; students: number; verified: number; pending: number; rejected: number; not_submitted: number; updates_pending: number }>`
      SELECT d.id, d.code::text AS code, d.name::text AS name, d.status, count(sas.student_id)::int AS students,
             count(*) FILTER (WHERE sas.status = 'VERIFIED')::int AS verified, count(*) FILTER (WHERE sas.status = 'PENDING')::int AS pending,
             count(*) FILTER (WHERE sas.status = 'REJECTED')::int AS rejected, count(*) FILTER (WHERE sas.status = 'NOT_SUBMITTED')::int AS not_submitted,
             count(*) FILTER (WHERE sas.update_pending)::int AS updates_pending
      FROM departments d LEFT JOIN student_academic_status sas ON sas.department_id = d.id GROUP BY d.id ORDER BY d.code`.execute(t)).rows;
    const pendingNoCoordinator = (await sql<{ code: string; pending: number }>`
      SELECT d.code::text AS code, count(a.id)::int AS pending
      FROM departments d JOIN students st ON st.department_id = d.id JOIN academic_submissions a ON a.student_id = st.id AND a.status = 'SUBMITTED'
      WHERE NOT EXISTS (SELECT 1 FROM coordinator_assignments ca JOIN users u ON u.id = ca.user_id AND u.status = 'ACTIVE' WHERE ca.department_id = d.id AND ca.ended_at IS NULL)
      GROUP BY d.id ORDER BY d.code`.execute(t)).rows;
    return { rows, pendingNoCoordinator };
  });
}

export async function pendingCount(s: SessionUser) {
  return withSession(s, async (t) => n((await sql<{ n: number }>`SELECT count(*)::int AS n FROM academic_submissions WHERE status = 'SUBMITTED'`.execute(t)).rows[0].n));
}

export async function myAcademicStatus(s: SessionUser) {
  return withSession(s, async (t) => (await sql<{ status: string; update_pending: boolean }>`SELECT status, update_pending FROM student_academic_status`.execute(t)).rows[0] ?? { status: "NOT_SUBMITTED", update_pending: false });
}

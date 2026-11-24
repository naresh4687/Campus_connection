import { sql, type RawBuilder } from "kysely";
import { PAGE_SIZE } from "@/components/ui/pagination";
import { COMPLETION_BANDS, isBand } from "@/lib/completion";
import { isCareerCode, type CareerCategory } from "@/lib/career";
import { likePattern, uuidSchema } from "@/lib/validation";
import { withSession, type SessionUser } from "../auth/session";

// All reads run as the signed-in user under RLS: an admin sees every student of the college, a coordinator only the
// students of their assigned departments, a student only themselves. No college_id or department filter comes from the client.
const n = (v: unknown) => Number(v ?? 0);
const where = (c: RawBuilder<unknown>[]) => (c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``);

export type StudentRow = { id: string; register_number: string; full_name: string; college_email: string; dept_code: string; dept_name: string; degree: string; passing_year: number; has_account: boolean; account_status: string; academic_status: string; update_pending: boolean; career_preference: string; completion: number };

const BASE = sql`
  SELECT s.id, s.register_number::text AS register_number, s.full_name, s.college_email::text AS college_email, s.department_id, d.code::text AS dept_code, d.name::text AS dept_name,
         s.degree, s.passing_year, s.user_id IS NOT NULL AS has_account,
         CASE WHEN u.status = 'DISABLED' THEN 'DISABLED' WHEN s.user_id IS NOT NULL THEN 'ACTIVE'
              WHEN EXISTS (SELECT 1 FROM invitations i WHERE i.student_id = s.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN 'INVITED'
              ELSE 'NOT_INVITED' END AS account_status,
         coalesce(sas.status, 'NOT_SUBMITTED') AS academic_status, coalesce(sas.update_pending, false) AS update_pending, s.career_preference, coalesce(pc.score, 0)::int AS completion
  FROM students s JOIN departments d ON d.id = s.department_id LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN student_academic_status sas ON sas.student_id = s.id
  LEFT JOIN student_profile_completion pc ON pc.student_id = s.id`;

export type StudentFilters = { q?: string; dept?: string; year?: string; account?: string; academics?: string; career?: string; completion?: string; page: number };

function conditions(f: StudentFilters, admin: boolean) {
  const c: RawBuilder<unknown>[] = [];
  if (f.q) c.push(sql`(b.full_name ILIKE ${likePattern(f.q)} ESCAPE '\\' OR b.register_number ILIKE ${likePattern(f.q)} ESCAPE '\\' OR b.college_email ILIKE ${likePattern(f.q)} ESCAPE '\\')`);
  if (f.dept && uuidSchema.safeParse(f.dept).success) c.push(sql`b.department_id = ${f.dept}::uuid`);
  if (f.year && /^\d{4}$/.test(f.year)) c.push(sql`b.passing_year = ${Number(f.year)}`);
  if (admin && ["NOT_INVITED", "INVITED", "ACTIVE", "DISABLED"].includes(f.account ?? "")) c.push(sql`b.account_status = ${f.account}`);
  if (['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'].includes(f.academics ?? '')) c.push(sql`b.academic_status = ${f.academics}`);
  if (isCareerCode(f.career)) c.push(sql`b.career_preference = ${f.career}`);
  if (isBand(f.completion)) c.push(sql`b.completion BETWEEN ${COMPLETION_BANDS[f.completion].min} AND ${COMPLETION_BANDS[f.completion].max}`);
  return c;
}

export async function listStudents(s: SessionUser, f: StudentFilters, opts: { admin: boolean; limit?: number }) {
  return withSession(s, async (t) => {
    const w = where(conditions(f, opts.admin));
    const total = n((await sql<{ n: number }>`WITH b AS (${BASE}) SELECT count(*)::int AS n FROM b ${w}`.execute(t)).rows[0].n);
    const limit = opts.limit ?? PAGE_SIZE;
    const rows = (await sql<StudentRow>`WITH b AS (${BASE}) SELECT * FROM b ${w} ORDER BY b.full_name, b.id LIMIT ${limit} OFFSET ${(f.page - 1) * limit}`.execute(t)).rows;
    const depts = (await sql<{ id: string; code: string; name: string }>`SELECT id, code::text AS code, name::text AS name FROM departments ORDER BY code`.execute(t)).rows;
    const years = (await sql<{ y: number }>`SELECT DISTINCT passing_year AS y FROM students ORDER BY y DESC`.execute(t)).rows.map((r) => r.y);
    return { rows, total, depts, years };
  });
}

/** Up to `limit` students matching the filters who have no account and no live invitation (for bulk invitation). */
export async function listInvitable(s: SessionUser, f: StudentFilters, limit: number) {
  return withSession(s, async (t) => {
    const c = conditions({ ...f, account: undefined }, true);
    c.push(sql`b.account_status = 'NOT_INVITED'`);
    const w = where(c);
    const total = n((await sql<{ n: number }>`WITH b AS (${BASE}) SELECT count(*)::int AS n FROM b ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<{ id: string; register_number: string; full_name: string; college_email: string }>`WITH b AS (${BASE}) SELECT b.id, b.register_number, b.full_name, b.college_email FROM b ${w} ORDER BY b.full_name, b.id LIMIT ${limit}`.execute(t)).rows;
    return { rows, total };
  });
}

export type StudentDetail = {
  id: string; department_id: string; dept_code: string; dept_name: string; register_number: string; full_name: string; college_email: string; personal_email: string | null; phone: string | null;
  degree: string; specialization: string | null; admission_year: number; passing_year: number; has_account: boolean; created_at: Date; updated_at: Date; import_id: string | null;
  user_id: string | null; user_status: string | null; last_login_at: Date | null; invite_expires: Date | null; career_preference: string;
  github_url: string | null; leetcode_url: string | null; linkedin_url: string | null;
};

export async function getStudent(s: SessionUser, id: string) {
  return withSession(s, async (t) =>
    (await sql<StudentDetail>`
      SELECT st.id, st.department_id, d.code::text AS dept_code, d.name::text AS dept_name, st.register_number::text AS register_number, st.full_name, st.college_email::text AS college_email,
             st.personal_email::text AS personal_email, st.phone, st.degree, st.specialization, st.admission_year, st.passing_year, st.user_id IS NOT NULL AS has_account,
             st.created_at, st.updated_at, st.import_id, st.user_id, u.status AS user_status, u.last_login_at, st.career_preference, st.github_url, st.leetcode_url, st.linkedin_url,
             (SELECT max(i.expires_at) FROM invitations i WHERE i.student_id = st.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) AS invite_expires
      FROM students st JOIN departments d ON d.id = st.department_id LEFT JOIN users u ON u.id = st.user_id WHERE st.id = ${id}`.execute(t)).rows[0] ?? null,
  );
}

export async function activeDepartments(s: SessionUser) {
  return withSession(s, async (t) => (await sql<{ id: string; code: string; name: string; status: string }>`SELECT id, code::text AS code, name::text AS name, status FROM departments ORDER BY status, code`.execute(t)).rows);
}

export async function myStudentRecord(s: SessionUser) {
  return withSession(s, async (t) =>
    (await sql<StudentDetail>`
      SELECT st.id, st.department_id, d.code::text AS dept_code, d.name::text AS dept_name, st.register_number::text AS register_number, st.full_name, st.college_email::text AS college_email,
             st.personal_email::text AS personal_email, st.phone, st.degree, st.specialization, st.admission_year, st.passing_year, true AS has_account, st.created_at, st.updated_at, st.import_id,
             NULL::uuid AS user_id, NULL::text AS user_status, NULL::timestamptz AS last_login_at, NULL::timestamptz AS invite_expires, st.career_preference, st.github_url, st.leetcode_url, st.linkedin_url
      FROM students st JOIN departments d ON d.id = st.department_id`.execute(t)).rows[0] ?? null,
  );
}

// ───────────── imports ─────────────
export type ImportRow = { id: string; filename: string; status: string; total_rows: number; valid_rows: number; error_rows: number; duplicate_rows: number; imported_rows: number; created_at: Date; headers: string[]; mapping: Record<string, number | null> | null };

export async function listImports(s: SessionUser) {
  return withSession(s, async (t) =>
    (await sql<Omit<ImportRow, "headers" | "mapping">>`SELECT id, filename, status, total_rows, valid_rows, error_rows, duplicate_rows, imported_rows, created_at FROM student_imports ORDER BY created_at DESC LIMIT 20`.execute(t)).rows,
  );
}

export async function getImport(s: SessionUser, id: string) {
  return withSession(s, async (t) =>
    (await sql<ImportRow>`SELECT id, filename, status, total_rows, valid_rows, error_rows, duplicate_rows, imported_rows, created_at, headers, mapping FROM student_imports WHERE id = ${id}`.execute(t)).rows[0] ?? null,
  );
}

export type ImportRowDetail = { row_number: number; status: string; errors: string[]; raw: string[] | null; normalized: Record<string, string | number | null> | null };

export async function listImportRows(s: SessionUser, id: string, f: { status?: string; page: number }) {
  return withSession(s, async (t) => {
    const c: RawBuilder<unknown>[] = [sql`import_id = ${id}`];
    if (f.status && ["VALID", "ERROR", "DUPLICATE", "IMPORTED"].includes(f.status)) c.push(sql`status = ${f.status}`);
    const w = where(c);
    const total = n((await sql<{ n: number }>`SELECT count(*)::int AS n FROM student_import_rows ${w}`.execute(t)).rows[0].n);
    const rows = (await sql<ImportRowDetail>`SELECT row_number, status, errors, raw, normalized FROM student_import_rows ${w} ORDER BY row_number LIMIT ${PAGE_SIZE} OFFSET ${(f.page - 1) * PAGE_SIZE}`.execute(t)).rows;
    return { rows, total };
  });
}

export async function allImportRows(s: SessionUser, id: string) {
  return withSession(s, async (t) =>
    (await sql<ImportRowDetail>`SELECT row_number, status, errors, raw, normalized FROM student_import_rows WHERE import_id = ${id} ORDER BY row_number`.execute(t)).rows,
  );
}

export async function importValidationContext(s: SessionUser, id: string) {
  return withSession(s, async (t) => {
    const imp = (await sql<{ status: string; headers: string[] }>`SELECT status, headers FROM student_imports WHERE id = ${id}`.execute(t)).rows[0];
    if (!imp) return null;
    const rows = (await sql<{ raw: string[] | null }>`SELECT raw FROM student_import_rows WHERE import_id = ${id} ORDER BY row_number`.execute(t)).rows.map((r) => r.raw ?? []);
    const depts = (await sql<{ id: string; code: string; name: string; status: string }>`SELECT id, code::text AS code, name::text AS name, status FROM departments`.execute(t)).rows;
    const existing = (await sql<{ r: string; e: string }>`SELECT lower(register_number::text) AS r, lower(college_email::text) AS e FROM students`.execute(t)).rows;
    return { status: imp.status, headers: imp.headers, rows, depts, existingRegisters: new Set(existing.map((x) => x.r)), existingEmails: new Set(existing.map((x) => x.e)) };
  });
}

/** The six career categories as this college shows them (labels and visibility applied by the database). */
export async function careerCategories(s: SessionUser): Promise<CareerCategory[]> {
  return withSession(s, async (t) => (await sql<CareerCategory>`SELECT code, label, active FROM students.career_categories()`.execute(t)).rows);
}

export type CareerHistoryRow = { id: string; previous: string; new_preference: string; reason: string; changed_by_name: string | null; changed_by_role: string; changed_at: string };
/** The full path of one student's career preference, newest first. Visible only to those who can see the student (row-level security). */
export async function careerHistory(s: SessionUser, studentId: string): Promise<CareerHistoryRow[]> {
  return withSession(s, async (t) => (await sql<CareerHistoryRow>`
    SELECT h.id::text AS id, h.previous, h.new_preference, h.reason, u.full_name AS changed_by_name, h.changed_by_role, h.changed_at::text AS changed_at
      FROM career_preference_history h LEFT JOIN users u ON u.id = h.changed_by WHERE h.student_id = ${studentId}::uuid ORDER BY h.id DESC`.execute(t)).rows);
}

export type Completion = { contact: boolean; academics: boolean; semesters: boolean; document: boolean; career: boolean; achievement: boolean; score: number };

/** One student's completion flags and score (their own, or one the viewer may see). Null when the viewer cannot see the student. */
export async function completionFor(s: SessionUser, studentId?: string): Promise<Completion | null> {
  return withSession(s, async (t) => (await (studentId
    ? sql<Completion>`SELECT contact, academics, semesters, document, career, achievement, score::int AS score FROM student_profile_completion WHERE student_id = ${studentId}`
    : sql<Completion>`SELECT contact, academics, semesters, document, career, achievement, score::int AS score FROM student_profile_completion`).execute(t)).rows[0] ?? null);
}

export type DriveHistoryRow = {
  drive_id: string; company_name: string; job_title: string; registration_status: string; registered_at: Date; selected: boolean;
  offer_status: string | null; offered_ctc_lpa: string | null; placement_status: string | null; joined_on: string | null;
};
/** Drive history and placement status for one student (administrator, or the coordinator of the student's department; anyone else gets no rows). */
export const driveHistory = (s: SessionUser, studentId: string) => withSession(s, async (t) =>
  (await sql<DriveHistoryRow>`SELECT drive_id, company_name, job_title, registration_status, registered_at, selected, offer_status, offered_ctc_lpa::text AS offered_ctc_lpa, placement_status, joined_on::text AS joined_on FROM students.drive_history(${studentId}::uuid)`.execute(t)).rows);

import { sql, type RawBuilder } from "kysely";
import { PAGE_SIZE } from "@/components/ui/pagination";
import { likePattern, uuidSchema } from "@/lib/validation";
import { withSession, type SessionUser } from "../auth/session";

// All reads run as the signed-in user under RLS: an admin sees every student of the college, a coordinator only the
// students of their assigned departments, a student only themselves. No college_id or department filter comes from the client.
const n = (v: unknown) => Number(v ?? 0);
const where = (c: RawBuilder<unknown>[]) => (c.length ? sql`WHERE ${sql.join(c, sql` AND `)}` : sql``);

export type StudentRow = { id: string; register_number: string; full_name: string; college_email: string; dept_code: string; dept_name: string; degree: string; passing_year: number; has_account: boolean; account_status: string; academic_status: string; update_pending: boolean };

const BASE = sql`
  SELECT s.id, s.register_number::text AS register_number, s.full_name, s.college_email::text AS college_email, s.department_id, d.code::text AS dept_code, d.name::text AS dept_name,
         s.degree, s.passing_year, s.user_id IS NOT NULL AS has_account,
         CASE WHEN u.status = 'DISABLED' THEN 'DISABLED' WHEN s.user_id IS NOT NULL THEN 'ACTIVE'
              WHEN EXISTS (SELECT 1 FROM invitations i WHERE i.student_id = s.id AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()) THEN 'INVITED'
              ELSE 'NOT_INVITED' END AS account_status,
         coalesce(sas.status, 'NOT_SUBMITTED') AS academic_status, coalesce(sas.update_pending, false) AS update_pending
  FROM students s JOIN departments d ON d.id = s.department_id LEFT JOIN users u ON u.id = s.user_id
  LEFT JOIN student_academic_status sas ON sas.student_id = s.id`;

export type StudentFilters = { q?: string; dept?: string; year?: string; account?: string; academics?: string; page: number };

function conditions(f: StudentFilters, admin: boolean) {
  const c: RawBuilder<unknown>[] = [];
  if (f.q) c.push(sql`(b.full_name ILIKE ${likePattern(f.q)} ESCAPE '\\' OR b.register_number ILIKE ${likePattern(f.q)} ESCAPE '\\' OR b.college_email ILIKE ${likePattern(f.q)} ESCAPE '\\')`);
  if (f.dept && uuidSchema.safeParse(f.dept).success) c.push(sql`b.department_id = ${f.dept}::uuid`);
  if (f.year && /^\d{4}$/.test(f.year)) c.push(sql`b.passing_year = ${Number(f.year)}`);
  if (admin && ["NOT_INVITED", "INVITED", "ACTIVE", "DISABLED"].includes(f.account ?? "")) c.push(sql`b.account_status = ${f.account}`);
  if (['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'].includes(f.academics ?? '')) c.push(sql`b.academic_status = ${f.academics}`);
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
  user_id: string | null; user_status: string | null; last_login_at: Date | null; invite_expires: Date | null;
};

export async function getStudent(s: SessionUser, id: string) {
  return withSession(s, async (t) =>
    (await sql<StudentDetail>`
      SELECT st.id, st.department_id, d.code::text AS dept_code, d.name::text AS dept_name, st.register_number::text AS register_number, st.full_name, st.college_email::text AS college_email,
             st.personal_email::text AS personal_email, st.phone, st.degree, st.specialization, st.admission_year, st.passing_year, st.user_id IS NOT NULL AS has_account,
             st.created_at, st.updated_at, st.import_id, st.user_id, u.status AS user_status, u.last_login_at,
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
             NULL::uuid AS user_id, NULL::text AS user_status, NULL::timestamptz AS last_login_at, NULL::timestamptz AS invite_expires
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

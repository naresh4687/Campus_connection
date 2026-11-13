import { randomBytes, randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import { createDb, withTenantTx, type Database } from "../../src/server/db";
import type { Role } from "../../src/server/db/context";
import { hashToken, newToken } from "../../src/server/auth/tokens";
import { appUrl, withOwner } from "./helpers";

/** A syntactically valid Argon2id string. DB-level tests do not need a verifiable hash. */
export const FAKE_HASH = "$argon2id$v=19$m=19456,t=2,p=1$ZmFrZXNhbHQ$ZmFrZWhhc2hmYWtlaGFzaGZha2VoYXNoZmFrZWhhc2g";

export type Actor = { userId: string; collegeId: string | null; role: Role; email: string };

export const uniq = (p: string) => `${p}-${randomBytes(4).toString("hex")}`;
export const emailFor = (p: string) => `${uniq(p)}@example.test`;

let shared: Kysely<Database> | undefined;
export const appDb = () => (shared ??= createDb(appUrl(), 4));
export const closeAppDb = async () => { await shared?.destroy(); shared = undefined; };

/** Runs a function as the owner inside a transaction using the cc_auth role (BYPASSRLS) to inspect raw rows. */
export async function inspect<T extends Record<string, unknown> = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return withOwner(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL ROLE cc_auth");
      return (await c.query(text, params)).rows as T[];
    } finally {
      await c.query("ROLLBACK");
    }
  });
}

/** Ensures exactly one platform admin exists (the real bootstrap path) and returns it. */
export async function platformAdmin(): Promise<Actor> {
  const existing = await inspect<{ id: string; email: string }>("SELECT id, email FROM users WHERE role = 'PLATFORM_SUPER_ADMIN' LIMIT 1");
  if (existing[0]) return { userId: existing[0].id, collegeId: null, role: "PLATFORM_SUPER_ADMIN", email: existing[0].email };
  const email = "platform-admin@example.test";
  const id = await withOwner(async (c) => (await c.query("SELECT auth.bootstrap_platform_admin($1, $2, $3) AS id", [email, "Platform Admin", FAKE_HASH])).rows[0].id as string);
  return { userId: id, collegeId: null, role: "PLATFORM_SUPER_ADMIN", email };
}

/** Submits a (valid, synthetic) public application and returns its id + status-link token. */
export async function submitApplication(over: Partial<{ name: string; email: string; website: string; phone: string; students: number; state: string; type: string }> = {}) {
  const token = newToken();
  const email = over.email ?? emailFor("principal");
  const r = await sql<{ id: string }>`SELECT platform.submit_application(${hashToken(token)}, ${over.name ?? uniq("Test College")}, ${email}, ${"12 Example Road, Testville"},
    ${over.state ?? "Tamil Nadu"}, ${"Coimbatore"}, ${over.website ?? "https://college.example.test"}, ${"Dr. Test Principal"}, ${over.phone ?? "+91 98765 43210"},
    ${over.type ?? "PRIVATE"}, ${over.students ?? 1200}) AS id`.execute(appDb());
  return { id: r.rows[0].id, token, email };
}

/** Creates a college the way production does: public application -> review -> approval by a platform admin. */
export async function createCollege(name = uniq("College")): Promise<string> {
  const pa = await platformAdmin();
  const app = await submitApplication({ name });
  await withTenantTx(pa, (t) => sql`SELECT platform.start_review(${app.id}::uuid)`.execute(t), appDb());
  const r = await withTenantTx(pa, (t) => sql<{ id: string }>`SELECT platform.approve_application(${app.id}::uuid) AS id`.execute(t), appDb());
  return r.rows[0].id;
}

/** The college's default test department (code GEN), created on first use by the college's admin. */
const deptCache = new Map<string, string>();
export async function defaultDepartment(admin: Actor, collegeId: string): Promise<string> {
  const hit = deptCache.get(collegeId);
  if (hit) return hit;
  const existing = await inspect<{ id: string }>("SELECT id FROM departments WHERE college_id = $1 AND code = 'GEN'", [collegeId]);
  if (existing[0]) { deptCache.set(collegeId, existing[0].id); return existing[0].id; }
  const r = await withTenantTx(admin, (t) => sql<{ id: string }>`SELECT college.create_department('General Studies', 'GEN', null) AS id`.execute(t), appDb());
  deptCache.set(collegeId, r.rows[0].id);
  return r.rows[0].id;
}

export type StudentInput = { department: string; register: string; name: string; email: string; personal?: string | null; phone?: string | null; degree?: string; spec?: string | null; admission?: number; passing?: number };
export const studentInput = (department: string, over: Partial<StudentInput> = {}): StudentInput => ({
  department, register: uniq("REG").toUpperCase(), name: "Test Student", email: emailFor("stu"), degree: "B.E.", admission: 2022, passing: 2026, ...over,
});
export const createStudentRecord = (admin: Actor, s: StudentInput) =>
  withTenantTx(admin, (t) => sql<{ id: string }>`SELECT students.create_student(${s.department}::uuid, ${s.register}, ${s.name}, ${s.email}, ${s.personal ?? null}, ${s.phone ?? null},
    ${s.degree ?? "B.E."}, ${s.spec ?? null}, ${s.admission ?? 2022}, ${s.passing ?? 2026}) AS id`.execute(t), appDb()).then((r) => r.rows[0].id);

/** Creates a user through the REAL flow: authorised invitation -> acceptance. Students go through their record: create -> invite -> accept. */
export async function createUser(inviter: Actor, role: Exclude<Role, "PLATFORM_SUPER_ADMIN">, collegeId: string, label = role.toLowerCase(), passwordHash = FAKE_HASH, email = emailFor(label)): Promise<Actor & { token: string; studentId?: string }> {
  const token = newToken();
  let studentId: string | undefined;
  if (role === "STUDENT") {
    const dept = await defaultDepartment(inviter, collegeId);
    studentId = await createStudentRecord(inviter, studentInput(dept, { name: "Test " + label, email }));
    await withTenantTx(inviter, (t) => sql`SELECT students.invite_student(${studentId}::uuid, ${hashToken(token)}, 3600)`.execute(t), appDb());
  } else {
    await withTenantTx(inviter, (t) => sql`SELECT auth.create_invitation(${email}, ${role}, ${collegeId}::uuid, ${hashToken(token)}, 3600)`.execute(t), appDb());
  }
  const r = await sql<{ user_id: string }>`SELECT * FROM auth.accept_invitation(${hashToken(token)}, ${"Test " + label}, ${passwordHash})`.execute(appDb());
  return { userId: r.rows[0].user_id, collegeId, role, email, token, studentId };
}

/** Two independent colleges, each with a full staff + student set. */
export async function seedTwoColleges() {
  const pa = await platformAdmin();
  const out: Record<"A" | "B", { collegeId: string; admin: Actor; officer: Actor; coordinator: Actor; student: Actor }> = {} as never;
  for (const k of ["A", "B"] as const) {
    const collegeId = await createCollege(uniq(`College ${k}`));
    const admin = await createUser(pa, "COLLEGE_ADMIN", collegeId, `admin${k}`);
    const officer = await createUser(admin, "PLACEMENT_OFFICER", collegeId, `officer${k}`);
    const coordinator = await createUser(admin, "COORDINATOR", collegeId, `coord${k}`);
    const student = await createUser(admin, "STUDENT", collegeId, `student${k}`);
    out[k] = { collegeId, admin, officer, coordinator, student };
  }
  return { pa, ...out };
}

export const randomId = () => randomUUID();

export const DENIED = "42501";
/** Resolves to the Postgres error code of a rejected promise, or "OK" if it succeeded. */
export async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? `no-code:${(e as Error).message}`;
  }
  return "OK";
}
/** Runs a write as the cc_auth definer role (bypasses RLS) to simulate time passing / a DBA bypassing the app. */
export async function adminWrite(text: string, params: unknown[] = []) {
  await withOwner(async (c) => {
    await c.query("BEGIN");
    try {
      await c.query("SET LOCAL ROLE cc_auth");
      await c.query(text, params);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    }
  });
}

// ───────────── shared helpers for department/student/coordinator scenarios (Phase 5+) ─────────────
export async function makeDepartment(admin: Actor): Promise<string> {
  return (await withTenantTx(admin, (t) => sql<{ id: string }>`SELECT college.create_department(${uniq("Dept")}, ${uniq("D").slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X")}, null) AS id`.execute(t), appDb())).rows[0].id;
}
/** A student account placed in the given department. */
export async function makeStudentIn(admin: Actor, dept: string, label: string): Promise<Actor & { studentId: string }> {
  const u = await createUser(admin, "STUDENT", admin.collegeId!, label);
  const [s] = await inspect<{ register_number: string; full_name: string; college_email: string; degree: string; admission_year: number; passing_year: number }>(
    "SELECT register_number::text AS register_number, full_name, college_email::text AS college_email, degree, admission_year, passing_year FROM students WHERE id = $1", [u.studentId]);
  await withTenantTx(admin, (t) => sql`SELECT students.update_student(${u.studentId}::uuid, ${dept}::uuid, ${s.register_number}, ${s.full_name}, ${s.college_email}, null, null, ${s.degree}, null, ${s.admission_year}, ${s.passing_year})`.execute(t), appDb());
  return { ...u, studentId: u.studentId! };
}
export async function makeCoordinator(admin: Actor, depts: string[], label: string): Promise<Actor> {
  const c = await createUser(admin, "COORDINATOR", admin.collegeId!, label);
  for (const d of depts) await withTenantTx(admin, (t) => sql`SELECT college.assign_coordinator(${d}::uuid, ${c.userId}::uuid)`.execute(t), appDb());
  return c;
}

// ───────────── drives (Phase 8+) ─────────────
export type DriveInput = {
  company: string; title: string; description: string | null; location: string | null; type: string; ctc: number | null; ctcNote: string | null; bond: string | null; qualification: string | null;
  openings: number | null; deadline: string | null; interview: string | null; instructions: string | null; departments: string[]; years: number[]; degrees: string[];
  minCgpa: number | null; minTenth: number | null; minTwelfth: number | null; minDiploma: number | null; maxBacklogs: number | null; maxArrears: number | null;
};
export const futureDeadline = (days = 14) => new Date(Date.now() + days * 86400_000).toISOString();
export async function makeCompany(officer: Actor, name = uniq("Co")): Promise<string> {
  return (await withTenantTx(officer, (t) => sql<{ id: string }>`SELECT placement.create_company(${name}, null, 'Software', null, null, null, null, 'Pune') AS id`.execute(t), appDb())).rows[0].id;
}
export const driveInput = (company: string, departments: string[], o: Partial<DriveInput> = {}): DriveInput => ({
  company, title: "Software Engineer", description: "Build things", location: "Pune", type: "FULL_TIME", ctc: 6.5, ctcNote: null, bond: null, qualification: "B.E./B.Tech", openings: 10,
  deadline: futureDeadline(), interview: null, instructions: null, departments, years: [2026], degrees: [], minCgpa: null, minTenth: null, minTwelfth: null, minDiploma: null, maxBacklogs: null, maxArrears: null, ...o,
});
export function saveDriveSql(id: string | null, d: DriveInput) {
  return sql`SELECT placement.save_drive(${id}::uuid, ${d.company}::uuid, ${d.title}, ${d.description}, ${d.location}, ${d.type}, ${d.ctc}::numeric, ${d.ctcNote}, ${d.bond}, ${d.qualification}, ${d.openings}::int, ${d.deadline}::timestamptz,
    ${d.interview}, ${d.instructions}, ${sql`ARRAY[${d.departments.length ? sql.join(d.departments.map((x) => sql`${x}::uuid`)) : sql``}]::uuid[]`}, ${sql`ARRAY[${d.years.length ? sql.join(d.years.map((y) => sql`${y}::int`)) : sql``}]::int[]`}, ${sql`ARRAY[${d.degrees.length ? sql.join(d.degrees.map((x) => sql`${x}`)) : sql``}]::text[]`},
    ${d.minCgpa}::numeric, ${d.minTenth}::numeric, ${d.minTwelfth}::numeric, ${d.minDiploma}::numeric, ${d.maxBacklogs}::int, ${d.maxArrears}::int) AS id`;
}
export async function makeDrive(officer: Actor, d: DriveInput, publish = false): Promise<string> {
  const id = (await withTenantTx(officer, (t) => saveDriveSql(null, d).execute(t), appDb())).rows[0] as { id: string };
  if (publish) await withTenantTx(officer, (t) => sql`SELECT placement.publish_drive(${id.id}::uuid)`.execute(t), appDb());
  return id.id;
}

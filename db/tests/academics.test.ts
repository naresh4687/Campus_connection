import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, createCollege, createUser, DENIED, inspect, seedTwoColleges, uniq, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));

type V = { cgpa: number | null; tenth: number | null; twelfth: number | null; diploma: number | null; backlogs: number | null; arrears: number | null; note: string | null };
const vals = (o: Partial<V> = {}): V => ({ cgpa: 8.25, tenth: 90.5, twelfth: 88, diploma: null, backlogs: 0, arrears: 1, note: null, ...o });
const submit = (a: Actor | null, o: Partial<V> = {}) => {
  const v = vals(o);
  return call(a, sql`SELECT academics.submit(${v.cgpa}::numeric, ${v.tenth}::numeric, ${v.twelfth}::numeric, ${v.diploma}::numeric, ${v.backlogs}::int, ${v.arrears}::int, ${v.note}) AS id`);
};
const submitId = async (a: Actor, o: Partial<V> = {}) => (await submit(a, o)).rows[0] as { id: string };
const verify = (a: Actor | null, id: string, note: string | null = null) => call(a, sql`SELECT academics.verify(${id}::uuid, ${note})`);
const reject = (a: Actor | null, id: string, reason: string | null = "Marks do not match the college records") => call(a, sql`SELECT academics.reject(${id}::uuid, ${reason})`);
const withdraw = (a: Actor | null, id: string) => call(a, sql`SELECT academics.withdraw(${id}::uuid)`);
const statusOf = async (id: string) => (await inspect<{ status: string }>("SELECT status FROM academic_submissions WHERE id = $1", [id]))[0].status;
const viewStatus = async (who: Actor, studentId: string) => (await as(who, (t) => sql<{ status: string; update_pending: boolean }>`SELECT status, update_pending FROM student_academic_status WHERE student_id = ${studentId}`.execute(t))).rows[0];
const visibleSubs = async (who: Actor) => (await as(who, (t) => sql<{ id: string }>`SELECT id FROM academic_submissions`.execute(t))).rows.map((r) => r.id).sort();

async function mkDept(admin: Actor) {
  return (await as(admin, (t) => sql<{ id: string }>`SELECT college.create_department(${uniq("Dept")}, ${uniq("D").slice(0, 8).toUpperCase().replace(/[^A-Z0-9]/g, "X")}, null) AS id`.execute(t))).rows[0].id;
}
/** A student account placed in the given department. */
async function studentIn(admin: Actor, dept: string, label: string): Promise<Actor & { studentId: string }> {
  const u = await createUser(admin, "STUDENT", admin.collegeId!, label);
  const [s] = await inspect<{ register_number: string; full_name: string; college_email: string; degree: string; admission_year: number; passing_year: number }>(
    "SELECT register_number::text AS register_number, full_name, college_email::text AS college_email, degree, admission_year, passing_year FROM students WHERE id = $1", [u.studentId]);
  await as(admin, (t) => sql`SELECT students.update_student(${u.studentId}::uuid, ${dept}::uuid, ${s.register_number}, ${s.full_name}, ${s.college_email}, null, null, ${s.degree}, null, ${s.admission_year}, ${s.passing_year})`.execute(t));
  return { ...u, studentId: u.studentId! };
}
async function coordinatorFor(admin: Actor, depts: string[], label: string) {
  const c = await createUser(admin, "COORDINATOR", admin.collegeId!, label);
  for (const d of depts) await as(admin, (t) => sql`SELECT college.assign_coordinator(${d}::uuid, ${c.userId}::uuid)`.execute(t));
  return c;
}

let d1: string; let d2: string;
let s1: Actor & { studentId: string }; let s2: Actor & { studentId: string }; let sOther: Actor & { studentId: string };
let c1: Actor; let c1b: Actor; let c2: Actor;

beforeAll(async () => {
  w = await seedTwoColleges();
  d1 = await mkDept(w.A.admin); d2 = await mkDept(w.A.admin);
  s1 = await studentIn(w.A.admin, d1, "acad1"); s2 = await studentIn(w.A.admin, d1, "acad2"); sOther = await studentIn(w.A.admin, d2, "acad3");
  c1 = await coordinatorFor(w.A.admin, [d1], "co1"); c1b = await coordinatorFor(w.A.admin, [d1], "co1b"); c2 = await coordinatorFor(w.A.admin, [d2], "co2");
});
afterAll(async () => { await closeAppDb(); });

describe("who can use the academic functions", () => {
  it("submit/withdraw are for students only; verify/reject for coordinators only (every other caller refused)", async () => {
    const sub = await submitId(s2);
    for (const who of [null, w.A.admin, w.A.officer, w.A.coordinator, c1, w.pa]) {
      expect(await code(submit(who)), `submit as ${who?.role ?? "anonymous"}`).toBe(DENIED);
      expect(await code(withdraw(who, sub.id)), `withdraw as ${who?.role ?? "anonymous"}`).toBe(DENIED);
    }
    for (const who of [null, w.A.admin, w.A.officer, w.A.student, s2, w.pa]) {
      expect(await code(verify(who, sub.id)), `verify as ${who?.role ?? "anonymous"}`).toBe(DENIED);
      expect(await code(reject(who, sub.id)), `reject as ${who?.role ?? "anonymous"}`).toBe(DENIED);
    }
    expect(await statusOf(sub.id)).toBe("SUBMITTED");
    await withdraw(s2, sub.id);
  });

  it("only a coordinator CURRENTLY assigned to the student's department may decide: other departments, other colleges and former assignees are refused", async () => {
    const st = await studentIn(w.A.admin, d1, "scope1");
    const sub = await submitId(st);
    expect(await code(verify(c2, sub.id))).toBe(DENIED);                 // coordinator of another department
    expect(await code(verify(w.B.coordinator, sub.id))).toBe("22023");   // other college: the submission does not exist for them
    const former = await coordinatorFor(w.A.admin, [d1], "former");
    await as(w.A.admin, (t) => sql`SELECT college.unassign_coordinator(${d1}::uuid, ${former.userId}::uuid)`.execute(t));
    expect(await code(verify(former, sub.id))).toBe(DENIED);
    expect(await code(reject(former, sub.id))).toBe(DENIED);
    expect(await statusOf(sub.id)).toBe("SUBMITTED");
    expect(await code(verify(c1, sub.id))).toBe("OK");
  });

  it("the runtime role cannot write academic submissions directly, and a student cannot self-verify", async () => {
    const st = await studentIn(w.A.admin, d1, "selfv");
    const sub = await submitId(st);
    expect(await code(as(st, (t) => sql`UPDATE academic_submissions SET status = 'VERIFIED' WHERE id = ${sub.id}`.execute(t)))).toBe(DENIED);
    expect(await code(as(st, (t) => sql`UPDATE academic_submissions SET cgpa = 10 WHERE id = ${sub.id}`.execute(t)))).toBe(DENIED);
    expect(await code(as(st, (t) => sql`DELETE FROM academic_submissions WHERE id = ${sub.id}`.execute(t)))).toBe(DENIED);
    expect(await code(as(c1, (t) => sql`UPDATE academic_submissions SET status = 'VERIFIED', cgpa = 10 WHERE id = ${sub.id}`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`UPDATE academic_submissions SET status = 'VERIFIED' WHERE id = ${sub.id}`.execute(t)))).toBe(DENIED);
    expect(await code(as(st, (t) => sql`INSERT INTO academic_submissions (college_id, student_id, version, cgpa, tenth_percentage, twelfth_percentage, active_backlogs, historical_arrears, degree, department_id, passing_year, status, submitted_by, reviewed_by, reviewed_at)
      VALUES (${st.collegeId}, ${st.studentId}, 99, 10, 100, 100, 0, 0, 'B.E.', ${d1}, 2026, 'VERIFIED', ${st.userId}, ${st.userId}, now())`.execute(t)))).toBe(DENIED);
    expect(await statusOf(sub.id)).toBe("SUBMITTED");
  });
});

describe("submitting academic details", () => {
  it("creates version 1 with a snapshot of the student's identity and the exact values given", async () => {
    const st = await studentIn(w.A.admin, d1, "v1");
    const { id } = await submitId(st, { cgpa: 7.5, tenth: 81.25, twelfth: null, diploma: 77, backlogs: 2, arrears: 3, note: "Lateral entry" });
    const [r] = await inspect<Record<string, unknown>>("SELECT version, status, cgpa::float8 AS cgpa, tenth_percentage::float8 AS tenth, twelfth_percentage, diploma_percentage::float8 AS diploma, active_backlogs, historical_arrears, student_note, degree, department_id, passing_year, submitted_by FROM academic_submissions WHERE id = $1", [id]);
    expect(r).toMatchObject({ version: 1, status: "SUBMITTED", cgpa: 7.5, tenth: 81.25, twelfth_percentage: null, diploma: 77, active_backlogs: 2, historical_arrears: 3, student_note: "Lateral entry", degree: "B.E.", department_id: d1, passing_year: 2026, submitted_by: st.userId });
  });

  it("missing is never zero: blank optional marks stay NULL, required fields cannot be omitted, and 12th or diploma must be given", async () => {
    const st = await studentIn(w.A.admin, d1, "miss");
    for (const [label, o] of [["no cgpa", { cgpa: null }], ["no 10th", { tenth: null }], ["no backlogs", { backlogs: null }], ["no arrears", { arrears: null }], ["no 12th and no diploma", { twelfth: null, diploma: null }]] as const) {
      expect(await code(submit(st, o)), label).toBe("22023");
    }
    const { id } = await submitId(st, { twelfth: 91, diploma: null });
    expect((await inspect<{ diploma_percentage: string | null }>("SELECT diploma_percentage FROM academic_submissions WHERE id = $1", [id]))[0].diploma_percentage).toBeNull();
    // zero is a real value and is accepted as such (a student with 0 active backlogs must say so)
    await withdraw(st, id);
    expect(await code(submit(st, { backlogs: 0, arrears: 0 }))).toBe("OK");
  });

  const bad: [string, Partial<V>][] = [
    ["CGPA above 10", { cgpa: 10.01 }], ["negative CGPA", { cgpa: -0.1 }], ["CGPA with 3 decimals", { cgpa: 8.255 }], ["10th above 100", { tenth: 100.5 }], ["negative 12th", { twelfth: -1 }],
    ["diploma above 100", { twelfth: null, diploma: 101 }], ["percentage with 3 decimals", { tenth: 90.123 }], ["negative backlogs", { backlogs: -1 }], ["absurd backlogs", { backlogs: 51 }], ["absurd arrears", { arrears: 201 }],
    ["over-long note", { note: "x".repeat(501) }],
  ];
  for (const [label, o] of bad) it(`rejects ${label}`, async () => {
    const st = await studentIn(w.A.admin, d1, "bad" + Math.random().toString(36).slice(2, 6));
    expect(await code(submit(st, o)), label).toBe("22023");
    expect(await inspect("SELECT 1 FROM academic_submissions WHERE student_id = $1", [st.studentId])).toHaveLength(0);
  });

  it("allows only one submission awaiting review; withdrawing frees the slot; parallel submits create exactly one", async () => {
    const st = await studentIn(w.A.admin, d1, "one");
    const results = await Promise.all(Array.from({ length: 6 }, () => code(submit(st))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(await inspect("SELECT 1 FROM academic_submissions WHERE student_id = $1", [st.studentId])).toHaveLength(1);
    const [open] = await inspect<{ id: string }>("SELECT id FROM academic_submissions WHERE student_id = $1", [st.studentId]);
    expect(await code(submit(st, { cgpa: 9 }))).toBe("23505");
    await withdraw(st, open.id);
    expect(await statusOf(open.id)).toBe("WITHDRAWN");
    expect(await code(withdraw(st, open.id))).toBe("22023");        // not pending any more
    expect(await code(submit(st, { cgpa: 9 }))).toBe("OK");
    expect((await inspect<{ max: number }>("SELECT max(version)::int AS max FROM academic_submissions WHERE student_id = $1", [st.studentId]))[0].max).toBe(2);
  });

  it("a student cannot withdraw someone else's submission", async () => {
    const a = await studentIn(w.A.admin, d1, "wa"); const b = await studentIn(w.A.admin, d1, "wb");
    const sub = await submitId(a);
    expect(await code(withdraw(b, sub.id))).toBe("22023");
    expect(await code(withdraw(w.B.student, sub.id))).toBe("22023");
    expect(await statusOf(sub.id)).toBe("SUBMITTED");
  });
});

describe("verification workflow", () => {
  it("verify moves the submission to VERIFIED, records who and when, keeps the values, and audits it", async () => {
    const st = await studentIn(w.A.admin, d1, "vv");
    const sub = await submitId(st);
    await verify(c1, sub.id, "Checked against the mark sheets");
    const [r] = await inspect<{ status: string; reviewed_by: string; reviewed_by_name: string; review_note: string; cgpa: string }>("SELECT status, reviewed_by, reviewed_by_name, review_note, cgpa::text AS cgpa FROM academic_submissions WHERE id = $1", [sub.id]);
    expect(r).toMatchObject({ status: "VERIFIED", reviewed_by: c1.userId, review_note: "Checked against the mark sheets", cgpa: "8.25" });
    expect(r.reviewed_by_name).toMatch(/co1/);
    expect(await inspect("SELECT 1 FROM audit_log WHERE action = 'ACADEMICS_VERIFIED' AND entity_id = $1 AND actor_user_id = $2 AND actor_role = 'COORDINATOR'", [sub.id, c1.userId])).toHaveLength(1);
  });

  it("reject needs a real reason, is terminal, and the student can then submit a corrected version", async () => {
    const st = await studentIn(w.A.admin, d1, "rj");
    const v1 = await submitId(st);
    for (const reason of [null, "", "   ", "no", "x".repeat(501)]) expect(await code(reject(c1, v1.id, reason)), String(reason).slice(0, 5)).toBe("22023");
    expect(await statusOf(v1.id)).toBe("SUBMITTED");
    await reject(c1, v1.id, "CGPA does not match the semester results");
    expect(await statusOf(v1.id)).toBe("REJECTED");
    expect(await code(verify(c1, v1.id))).toBe("22023");              // decided
    expect(await code(reject(c1, v1.id))).toBe("22023");
    expect(await code(withdraw(st, v1.id))).toBe("22023");
    const v2 = await submitId(st, { cgpa: 7.9 });
    expect((await inspect<{ version: number }>("SELECT version FROM academic_submissions WHERE id = $1", [v2.id]))[0].version).toBe(2);
    expect((await as(st, (t) => sql<{ rejection_reason: string }>`SELECT rejection_reason FROM academic_submissions WHERE id = ${v1.id}`.execute(t))).rows[0].rejection_reason).toBe("CGPA does not match the semester results");
  });

  it("a verified record stays in force while an update is pending; verifying the update supersedes it; rejecting the update leaves it verified", async () => {
    const st = await studentIn(w.A.admin, d1, "upd");
    const v1 = await submitId(st); await verify(c1, v1.id);
    expect(await viewStatus(st, st.studentId)).toEqual({ status: "VERIFIED", update_pending: false });
    const v2 = await submitId(st, { cgpa: 9.1 });
    expect(await viewStatus(st, st.studentId)).toEqual({ status: "VERIFIED", update_pending: true });
    expect(await statusOf(v1.id)).toBe("VERIFIED");                                           // still the verified one
    await reject(c1, v2.id, "The new CGPA is not yet published");
    expect(await statusOf(v1.id)).toBe("VERIFIED");
    expect(await viewStatus(st, st.studentId)).toEqual({ status: "VERIFIED", update_pending: false });
    const v3 = await submitId(st, { cgpa: 8.6 }); await verify(c1b, v3.id);                    // a different coordinator of the same department
    expect(await statusOf(v1.id)).toBe("SUPERSEDED");
    expect(await statusOf(v3.id)).toBe("VERIFIED");
    expect((await inspect<{ n: number }>("SELECT count(*)::int AS n FROM academic_submissions WHERE student_id = $1 AND status = 'VERIFIED'", [st.studentId]))[0].n).toBe(1);
    expect((await inspect<{ status: string }>("SELECT status FROM academic_submissions WHERE student_id = $1 ORDER BY version", [st.studentId])).map((r) => r.status)).toEqual(["SUPERSEDED", "REJECTED", "VERIFIED"]);
  });

  it("an identical resubmission of the verified values is refused", async () => {
    const st = await studentIn(w.A.admin, d1, "same");
    const v1 = await submitId(st); await verify(c1, v1.id);
    expect(await code(submit(st))).toBe("22023");
    expect(await code(submit(st, { cgpa: 8.26 }))).toBe("OK");
  });

  it("two coordinators deciding the same submission at once: exactly one succeeds, and there is only ever one VERIFIED record", async () => {
    const st = await studentIn(w.A.admin, d1, "race");
    const sub = await submitId(st);
    const res = await Promise.all([verify(c1, sub.id), verify(c1b, sub.id), reject(c1, sub.id), reject(c1b, sub.id)].map((p) => code(p)));
    expect(res.filter((r) => r === "OK")).toHaveLength(1);
    expect(["VERIFIED", "REJECTED"]).toContain(await statusOf(sub.id));
  });

  it("history is complete: every version stays, with outcome, reviewer name and reason", async () => {
    const st = await studentIn(w.A.admin, d1, "hist");
    const a = await submitId(st); await reject(c1, a.id, "Backlog count is wrong");
    const b = await submitId(st, { backlogs: 1 }); await withdraw(st, b.id);
    const c = await submitId(st, { backlogs: 2 }); await verify(c1b, c.id);
    const rows = await as(st, (t) => sql<{ version: number; status: string; reviewed_by_name: string | null; rejection_reason: string | null }>`SELECT version, status, reviewed_by_name, rejection_reason FROM academic_submissions WHERE student_id = ${st.studentId} ORDER BY version`.execute(t));
    expect(rows.rows.map((r) => [r.version, r.status])).toEqual([[1, "REJECTED"], [2, "WITHDRAWN"], [3, "VERIFIED"]]);
    expect(rows.rows[0].rejection_reason).toBe("Backlog count is wrong");
    expect(rows.rows[0].reviewed_by_name).toMatch(/co1/);
    expect(rows.rows[1].reviewed_by_name).toBeNull();
  });
});

describe("the database itself protects the record (even if the functions are bypassed)", () => {
  it("values and snapshot are immutable; closed submissions cannot be changed; illegal transitions and deletes are blocked", async () => {
    const st = await studentIn(w.A.admin, d1, "imm");
    const a = await submitId(st);
    await expect(adminWrite("UPDATE academic_submissions SET cgpa = 10 WHERE id = $1", [a.id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("UPDATE academic_submissions SET passing_year = 2020 WHERE id = $1", [a.id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("UPDATE academic_submissions SET student_note = 'edited' WHERE id = $1", [a.id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("UPDATE academic_submissions SET status = 'SUPERSEDED' WHERE id = $1", [a.id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM academic_submissions WHERE id = $1", [a.id])).rejects.toMatchObject({ code: DENIED });
    await reject(c1, a.id, "Please correct the CGPA");
    await expect(adminWrite("UPDATE academic_submissions SET status = 'VERIFIED' WHERE id = $1", [a.id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("UPDATE academic_submissions SET rejection_reason = 'rewritten history' WHERE id = $1", [a.id])).rejects.toMatchObject({ code: DENIED });
    expect(await inspect("SELECT 1 FROM pg_trigger WHERE tgrelid = 'academic_submissions'::regclass AND tgname = 'academic_submissions_guard'")).toHaveLength(1);
  });
  it("table constraints: a rejection needs a reason, a decision needs a reviewer, at most one open and one verified per student", async () => {
    const st = await studentIn(w.A.admin, d1, "chk");
    const a = await submitId(st);
    await expect(adminWrite("UPDATE academic_submissions SET status = 'REJECTED', reviewed_by = $2, reviewed_at = now(), closed_at = now() WHERE id = $1", [a.id, c1.userId])).rejects.toMatchObject({ code: "23514" });
    await expect(adminWrite("UPDATE academic_submissions SET status = 'VERIFIED' WHERE id = $1", [a.id])).rejects.toMatchObject({ code: "23514" });
    await expect(adminWrite(`INSERT INTO academic_submissions (college_id, student_id, version, cgpa, tenth_percentage, twelfth_percentage, active_backlogs, historical_arrears, degree, department_id, passing_year, submitted_by)
      VALUES ($1, $2, 7, 8, 80, 80, 0, 0, 'B.E.', $3, 2026, $4)`, [st.collegeId, st.studentId, d1, st.userId])).rejects.toMatchObject({ code: "23505" });   // second open one
    await expect(adminWrite(`INSERT INTO academic_submissions (college_id, student_id, version, cgpa, tenth_percentage, active_backlogs, historical_arrears, degree, department_id, passing_year, submitted_by)
      VALUES ($1, $2, 8, 8, 80, 0, 0, 'B.E.', $3, 2026, $4)`, [st.collegeId, st.studentId, d1, st.userId])).rejects.toMatchObject({ code: "23514" });         // neither 12th nor diploma
  });
  it("even bypassing the functions, a student can never have two VERIFIED records at once", async () => {
    const st = await studentIn(w.A.admin, d1, "twov");
    const a = await submitId(st); await verify(c1, a.id);
    const b = await submitId(st, { cgpa: 6.5 });
    await expect(adminWrite("UPDATE academic_submissions SET status = 'VERIFIED', reviewed_by = $2, reviewed_at = now() WHERE id = $1", [b.id, c1.userId])).rejects.toMatchObject({ code: "23505" });
    expect(await statusOf(a.id)).toBe("VERIFIED");
    expect(await statusOf(b.id)).toBe("SUBMITTED");
  });
  it("a submission cannot reference another college's student or department", async () => {
    await expect(adminWrite(`INSERT INTO academic_submissions (college_id, student_id, version, cgpa, tenth_percentage, twelfth_percentage, active_backlogs, historical_arrears, degree, department_id, passing_year, submitted_by)
      VALUES ($1, $2, 50, 8, 80, 80, 0, 0, 'B.E.', $3, 2026, $4)`, [w.A.collegeId, (w.B.student as { studentId?: string }).studentId ?? (await inspect<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [w.B.student.userId]))[0].id, d1, w.A.admin.userId])).rejects.toMatchObject({ code: "23503" });
  });
});

describe("who can read academic data (row level security)", () => {
  it("a student sees only their own submissions", async () => {
    const a = await studentIn(w.A.admin, d1, "ra"); const b = await studentIn(w.A.admin, d1, "rb");
    const sa = await submitId(a); const sb = await submitId(b);
    expect(await visibleSubs(a)).toEqual([sa.id]);
    expect(await visibleSubs(b)).toEqual([sb.id]);
    expect(await visibleSubs(w.B.student)).not.toContain(sa.id);
  });
  it("a coordinator sees only submissions of students in their CURRENT departments; reassignment and unassignment take effect immediately", async () => {
    const c = await coordinatorFor(w.A.admin, [d1], "vis");
    const inD1 = await studentIn(w.A.admin, d1, "vd1"); const inD2 = await studentIn(w.A.admin, d2, "vd2");
    const a = await submitId(inD1); const b = await submitId(inD2);
    expect(await visibleSubs(c)).toEqual(expect.arrayContaining([a.id]));
    expect(await visibleSubs(c)).not.toContain(b.id);
    await as(w.A.admin, (t) => sql`SELECT college.assign_coordinator(${d2}::uuid, ${c.userId}::uuid)`.execute(t));
    expect(await visibleSubs(c)).toEqual(expect.arrayContaining([a.id, b.id]));
    await as(w.A.admin, (t) => sql`SELECT college.unassign_coordinator(${d1}::uuid, ${c.userId}::uuid)`.execute(t));
    expect(await visibleSubs(c)).not.toContain(a.id);
    expect(await visibleSubs(c)).toContain(b.id);
    expect(await code(verify(c, a.id))).toBe(DENIED);
  });
  it("moving a student to another department moves who can see (and decide) their submissions", async () => {
    const st = await studentIn(w.A.admin, d1, "mv");
    const sub = await submitId(st);
    expect(await visibleSubs(c2)).not.toContain(sub.id);
    const [s] = await inspect<{ register_number: string; full_name: string; college_email: string }>("SELECT register_number::text AS register_number, full_name, college_email::text AS college_email FROM students WHERE id = $1", [st.studentId]);
    await as(w.A.admin, (t) => sql`SELECT students.update_student(${st.studentId}::uuid, ${d2}::uuid, ${s.register_number}, ${s.full_name}, ${s.college_email}, null, null, 'B.E.', null, 2022, 2026)`.execute(t));
    expect(await visibleSubs(c2)).toContain(sub.id);
    expect(await visibleSubs(c1)).not.toContain(sub.id);
    expect(await code(verify(c1, sub.id))).toBe(DENIED);
    expect(await code(verify(c2, sub.id))).toBe("OK");
  });
  it("an admin sees every submission of their college, another college's admin none, and officers, the platform and no-context see none", async () => {
    const st = await studentIn(w.A.admin, d1, "adm"); const sub = await submitId(st);
    expect(await visibleSubs(w.A.admin)).toContain(sub.id);
    expect(await visibleSubs(w.B.admin)).not.toContain(sub.id);
    for (const who of [w.A.officer, w.pa]) expect(await visibleSubs(who)).toEqual([]);
    expect((await sql`SELECT 1 FROM academic_submissions`.execute(db())).rows).toEqual([]);
  });
});

describe("derived status view", () => {
  it("NOT_SUBMITTED -> PENDING -> REJECTED -> PENDING -> VERIFIED, and withdrawn-only counts as NOT_SUBMITTED", async () => {
    const st = await studentIn(w.A.admin, d1, "vw");
    expect(await viewStatus(st, st.studentId)).toEqual({ status: "NOT_SUBMITTED", update_pending: false });
    const a = await submitId(st);
    expect(await viewStatus(st, st.studentId)).toMatchObject({ status: "PENDING" });
    await reject(c1, a.id, "Please re-check the CGPA value");
    expect(await viewStatus(st, st.studentId)).toMatchObject({ status: "REJECTED" });
    const b = await submitId(st, { cgpa: 8 });
    expect(await viewStatus(st, st.studentId)).toMatchObject({ status: "PENDING" });
    await verify(c1, b.id);
    expect(await viewStatus(st, st.studentId)).toMatchObject({ status: "VERIFIED" });
    const w2 = await studentIn(w.A.admin, d1, "vw2");
    await withdraw(w2, (await submitId(w2)).id);
    expect(await viewStatus(w2, w2.studentId)).toMatchObject({ status: "NOT_SUBMITTED" });
  });
  it("the view obeys the caller's row-level security: a coordinator sees rows only for their own students, others see none", async () => {
    const ids = async (who: Actor) => (await as(who, (t) => sql<{ student_id: string }>`SELECT student_id FROM student_academic_status`.execute(t))).rows.map((r) => r.student_id);
    expect(await ids(c2)).toEqual(expect.arrayContaining([sOther.studentId]));
    expect(await ids(c2)).not.toContain(s1.studentId);
    expect(await ids(w.B.admin)).not.toContain(s1.studentId);
    expect(await ids(s1)).toEqual([s1.studentId]);
    expect(await ids(w.pa)).toEqual([]);
    expect((await sql`SELECT 1 FROM student_academic_status`.execute(db())).rows).toEqual([]);
  });
});

describe("audit trail", () => {
  it("records submit, withdraw, verify and reject with the right actor and role, visible to the college admin only", async () => {
    const st = await studentIn(w.A.admin, d1, "au");
    const a = await submitId(st); await withdraw(st, a.id);
    const b = await submitId(st, { cgpa: 7 }); await reject(c1, b.id, "Values differ from records");
    const c = await submitId(st, { cgpa: 7.1 }); await verify(c1, c.id);
    const log = await inspect<{ action: string; actor_role: string }>("SELECT action, actor_role FROM audit_log WHERE entity_type = 'academic_submission' AND entity_id = ANY($1) ORDER BY id", [[a.id, b.id, c.id]]);
    expect(log.map((l) => `${l.actor_role}:${l.action}`)).toEqual(["STUDENT:ACADEMICS_SUBMITTED", "STUDENT:ACADEMICS_WITHDRAWN", "STUDENT:ACADEMICS_SUBMITTED", "COORDINATOR:ACADEMICS_REJECTED", "STUDENT:ACADEMICS_SUBMITTED", "COORDINATOR:ACADEMICS_VERIFIED"]);
    const seen = async (who: Actor) => (await as(who, (t) => sql`SELECT 1 FROM audit_log WHERE action LIKE 'ACADEMICS_%'`.execute(t))).rows.length;
    expect(await seen(w.A.admin)).toBeGreaterThan(0);
    expect(await seen(w.B.admin)).toBe(0);
    expect(await seen(c1)).toBe(0);
  });
});

describe("suspended college", () => {
  it("loses all academic authority and regains it on reactivation", async () => {
    const cid = await createCollege();
    const admin = await createUser(w.pa, "COLLEGE_ADMIN", cid, "sacad");
    const dept = await mkDept(admin);
    const st = await studentIn(admin, dept, "sacad-s");
    const co = await coordinatorFor(admin, [dept], "sacad-c");
    const sub = await submitId(st);
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'SUSPENDED', 'suspended for the test')`.execute(t));
    expect(await code(sql`SELECT academics.submit(8, 80, 80, null, 0, 0, null)`.execute(db()))).toBe(DENIED);
    expect(await code(sql`SELECT academics.verify(${sub.id}::uuid, null)`.execute(db()))).toBe(DENIED);
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'ACTIVE', null)`.execute(t));
    expect(await code(verify(co, sub.id))).toBe("OK");
  });
});

describe("semester results (migration 0023)", () => {
  type Sem = { semester: number; sgpa: number; backlogs: number };
  const sems = (n: number, sgpa = 8): Sem[] => Array.from({ length: n }, (_, i) => ({ semester: i + 1, sgpa, backlogs: 0 }));
  const submitSem = (a: Actor | null, s: unknown, o: Partial<V> = {}) => {
    const v = vals(o);
    return call(a, sql`SELECT academics.submit(${v.cgpa}::numeric, ${v.tenth}::numeric, ${v.twelfth}::numeric, ${v.diploma}::numeric, ${v.backlogs}::int, ${v.arrears}::int, ${v.note}, '{}'::uuid[], ${JSON.stringify(s)}::jsonb) AS id`);
  };
  const rows = (id: string) => inspect<{ semester: number; sgpa: string; backlogs: number }>("SELECT semester, sgpa::text AS sgpa, backlogs FROM semester_results WHERE submission_id = $1 ORDER BY semester", [id]);

  it("stores semesters with the submission; they are optional", async () => {
    const st = await studentIn(w.A.admin, d1, "sem1");
    const a = (await submitSem(st, sems(3, 8.5))).rows[0] as { id: string };
    expect((await rows(a.id)).map((r) => [r.semester, r.sgpa, r.backlogs])).toEqual([[1, "8.50", 0], [2, "8.50", 0], [3, "8.50", 0]]);
    const st2 = await studentIn(w.A.admin, d1, "sem2");
    const b = await submitId(st2);
    expect(await rows(b.id)).toEqual([]);
  });

  it("rejects bad semesters and writes nothing", async () => {
    const st = await studentIn(w.A.admin, d1, "sem3");
    for (const bad of [[{ semester: 0, sgpa: 8, backlogs: 0 }], [{ semester: 13, sgpa: 8, backlogs: 0 }], [{ semester: 1, sgpa: 10.5, backlogs: 0 }], [{ semester: 1, sgpa: 8.123, backlogs: 0 }],
                       [{ semester: 1, sgpa: 8, backlogs: 21 }], [{ semester: 1, sgpa: 8, backlogs: 0 }, { semester: 1, sgpa: 7, backlogs: 0 }], [{ semester: 1, sgpa: null, backlogs: 0 }], sems(13), { semester: 1 }]) {
      expect(await code(submitSem(st, bad)), JSON.stringify(bad)).not.toBe("OK");
    }
    expect(await inspect("SELECT 1 FROM academic_submissions WHERE student_id = $1", [st.studentId])).toEqual([]);
  });

  it("adding semesters to otherwise identical verified values is a real update; identical values and semesters are refused", async () => {
    const st = await studentIn(w.A.admin, d1, "sem4");
    const a = await submitId(st); await verify(c1, a.id);
    expect(await code(submit(st))).toBe("22023");                                  // same values, no semesters: nothing to update
    const b = (await submitSem(st, sems(2))).rows[0] as { id: string };            // same values + semesters: allowed
    await verify(c1, b.id);
    expect(await code(submitSem(st, sems(2)))).toBe("22023");                      // now identical including semesters
    expect(await code(submitSem(st, sems(3)))).toBe("OK");
  });

  it("is append-only and visible only to the student, their coordinator and the college admin", async () => {
    const st = await studentIn(w.A.admin, d1, "sem5");
    const a = (await submitSem(st, sems(2))).rows[0] as { id: string };
    expect(await code(adminWrite("UPDATE semester_results SET sgpa = 1 WHERE submission_id = $1", [a.id]))).toBe(DENIED);
    expect(await code(adminWrite("DELETE FROM semester_results WHERE submission_id = $1", [a.id]))).toBe(DENIED);
    const visible = async (who: Actor) => (await as(who, (t) => sql`SELECT id FROM semester_results WHERE submission_id = ${a.id}::uuid`.execute(t))).rows.length;
    expect(await visible(st)).toBe(2); expect(await visible(c1)).toBe(2); expect(await visible(w.A.admin)).toBe(2);
    for (const who of [c2, w.A.officer, w.B.admin, w.pa, s2]) expect(await visible(who), who.role).toBe(0);
    for (const who of [st, c1, w.A.admin]) expect(await code(call(who, sql`INSERT INTO semester_results (college_id, student_id, submission_id, semester, sgpa, backlogs) VALUES (${w.A.admin.collegeId}::uuid, ${st.studentId}::uuid, ${a.id}::uuid, 9, 8, 0)`))).toBe(DENIED);
  });
});

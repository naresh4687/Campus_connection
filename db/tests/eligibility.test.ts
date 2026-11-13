import { randomBytes, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, DENIED, driveInput, futureDeadline, inspect, makeCompany, makeCoordinator, makeDepartment, makeDrive, makeStudentIn, seedTwoColleges, type Actor, type DriveInput } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let co: string; let d1: string; let d2: string;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const hex = () => randomBytes(32).toString("hex");

type Vals = { cgpa?: number; tenth?: number; twelfth?: number | null; diploma?: number | null; backlogs?: number; arrears?: number };
/** Submit academic values as the student and have the department coordinator verify them (the only way a VERIFIED record exists). */
async function verified(s: Actor, coord: Actor, v: Vals = {}) {
  const id = (await call(s, sql`SELECT academics.submit(${v.cgpa ?? 8}::numeric, ${v.tenth ?? 80}::numeric, ${v.twelfth === undefined ? 80 : v.twelfth}::numeric, ${v.diploma !== undefined ? v.diploma : v.twelfth === null ? 70 : null}::numeric, ${v.backlogs ?? 0}::int, ${v.arrears ?? 0}::int, null) AS id`)).rows[0] as { id: string };
  await call(coord, sql`SELECT academics.verify(${id.id}::uuid, null)`);
  return id.id;
}
const publishedDrive = (o: Partial<DriveInput> = {}) => makeDrive(w.A.officer, { ...driveInput(co, [d1]), ...o }, true);
const check = async (s: Actor, drive: string) => (await call(s, sql`SELECT eligibility.check_drive(${drive}::uuid) AS r`)).rows[0] as { r: { result: string; checks: { criterion: string; status: string; actual: string | null }[]; engine_version: string } };
const result = async (s: Actor, drive: string) => (await check(s, drive)).r.result;
const register = (s: Actor | null, drive: string) => call(s, sql`SELECT registrations.register(${drive}::uuid) AS id`);
const withdraw = (s: Actor | null, drive: string) => call(s, sql`SELECT registrations.withdraw(${drive}::uuid)`);
let n = 0;
const fresh = async (dept = d1, coord?: Actor, v?: Vals | null) => {
  const s = await makeStudentIn(w.A.admin, dept, `elg${++n}`);
  if (v !== null) await verified(s, coord ?? c1, v);
  return s;
};
let c1: Actor; let c2: Actor;

beforeAll(async () => {
  w = await seedTwoColleges();
  co = await makeCompany(w.A.officer);
  d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin);
  c1 = await makeCoordinator(w.A.admin, [d1], "ec1"); c2 = await makeCoordinator(w.A.admin, [d2], "ec2");
});
afterAll(async () => { await closeAppDb(); });

describe("the engine decides from verified data only", () => {
  it("no academic submission -> NEEDS_DATA when academic criteria exist; unset criteria alone -> ELIGIBLE only with a verified record", async () => {
    const s = await fresh(d1, c1, null);
    const drive = await publishedDrive({ minCgpa: 7 });
    expect(await result(s, drive)).toBe("NEEDS_DATA");
  });
  it("a submitted-but-unverified record does not count (still NEEDS_DATA, however good the numbers)", async () => {
    const s = await fresh(d1, c1, null);
    await call(s, sql`SELECT academics.submit(10, 100, 100, null, 0, 0, null)`);
    expect(await result(s, await publishedDrive({ minCgpa: 7 }))).toBe("NEEDS_DATA");
  });
  it("a rejected record does not count", async () => {
    const s = await fresh(d1, c1, null);
    const id = (await call(s, sql`SELECT academics.submit(10, 100, 100, null, 0, 0, null) AS id`)).rows[0] as { id: string };
    await call(c1, sql`SELECT academics.reject(${id.id}::uuid, 'marks do not match the sheet')`);
    expect(await result(s, await publishedDrive({ minCgpa: 7 }))).toBe("NEEDS_DATA");
  });
  it("a verified record that meets every criterion -> ELIGIBLE, with a PASS line per criterion and the engine version", async () => {
    const s = await fresh(d1, c1, { cgpa: 8, tenth: 80, twelfth: 80, backlogs: 0, arrears: 1 });
    const { r } = await check(s, await publishedDrive({ minCgpa: 7, minTenth: 60, minTwelfth: 60, maxBacklogs: 0, maxArrears: 2 }));
    expect(r.result).toBe("ELIGIBLE");
    expect(r.engine_version).toBe("1");
    expect(r.checks.every((c) => c.status === "PASS")).toBe(true);
    expect(r.checks.map((c) => c.criterion)).toEqual(expect.arrayContaining(["DEPARTMENT", "PASSING_YEAR", "ACADEMIC_RECORD", "CGPA", "TENTH", "TWELFTH", "ACTIVE_BACKLOGS", "HISTORICAL_ARREARS"]));
  });
});

describe("thresholds, missing values and precedence (table-driven)", () => {
  const cases: { name: string; vals: Vals; crit: Partial<DriveInput>; want: string }[] = [
    { name: "CGPA exactly at the minimum is eligible (inclusive)", vals: { cgpa: 7 }, crit: { minCgpa: 7 }, want: "ELIGIBLE" },
    { name: "CGPA just below the minimum is not eligible", vals: { cgpa: 6.99 }, crit: { minCgpa: 7 }, want: "NOT_ELIGIBLE" },
    { name: "10th exactly at the minimum is eligible", vals: { tenth: 60 }, crit: { minTenth: 60 }, want: "ELIGIBLE" },
    { name: "10th below the minimum is not eligible", vals: { tenth: 59.99 }, crit: { minTenth: 60 }, want: "NOT_ELIGIBLE" },
    { name: "12th exactly at the minimum is eligible", vals: { twelfth: 55 }, crit: { minTwelfth: 55 }, want: "ELIGIBLE" },
    { name: "12th below the minimum is not eligible", vals: { twelfth: 54 }, crit: { minTwelfth: 55 }, want: "NOT_ELIGIBLE" },
    { name: "a MISSING 12th is never zero: NEEDS_DATA when 12th is required", vals: { twelfth: null }, crit: { minTwelfth: 50 }, want: "NEEDS_DATA" },
    { name: "a missing 12th does not matter when 12th is not required", vals: { twelfth: null }, crit: { minCgpa: 7 }, want: "ELIGIBLE" },
    { name: "a MISSING diploma is never zero: NEEDS_DATA when diploma is required", vals: { diploma: null }, crit: { minDiploma: 50 }, want: "NEEDS_DATA" },
    { name: "diploma at the minimum is eligible", vals: { diploma: 50 }, crit: { minDiploma: 50 }, want: "ELIGIBLE" },
    { name: "diploma below the minimum is not eligible", vals: { diploma: 49 }, crit: { minDiploma: 50 }, want: "NOT_ELIGIBLE" },
    { name: "active backlogs exactly at the maximum is eligible", vals: { backlogs: 1 }, crit: { maxBacklogs: 1 }, want: "ELIGIBLE" },
    { name: "one more active backlog than allowed is not eligible", vals: { backlogs: 2 }, crit: { maxBacklogs: 1 }, want: "NOT_ELIGIBLE" },
    { name: "zero allowed backlogs and zero held is eligible", vals: { backlogs: 0 }, crit: { maxBacklogs: 0 }, want: "ELIGIBLE" },
    { name: "historical arrears over the maximum is not eligible", vals: { arrears: 3 }, crit: { maxArrears: 2 }, want: "NOT_ELIGIBLE" },
    { name: "historical arrears at the maximum is eligible", vals: { arrears: 2 }, crit: { maxArrears: 2 }, want: "ELIGIBLE" },
    { name: "NOT_ELIGIBLE wins over NEEDS_DATA (a failed CGPA beats a missing 12th)", vals: { cgpa: 5, twelfth: null }, crit: { minCgpa: 7, minTwelfth: 50 }, want: "NOT_ELIGIBLE" },
    { name: "a drive with no academic thresholds is ELIGIBLE for a verified student", vals: {}, crit: {}, want: "ELIGIBLE" },
  ];
  for (const c of cases) {
    it(c.name, async () => {
      const s = await fresh(d1, c1, c.vals);
      expect(await result(s, await publishedDrive(c.crit))).toBe(c.want);
    });
  }
});

describe("identity criteria", () => {
  it("a student outside the eligible departments is NOT_ELIGIBLE, even with no academic data", async () => {
    const s = await fresh(d2, c2, null);
    const { r } = await check(s, await publishedDrive({ departments: [d1] }));
    expect(r.result).toBe("NOT_ELIGIBLE");
    expect(r.checks.find((c) => c.criterion === "DEPARTMENT")?.status).toBe("FAIL");
  });
  it("passing year must be listed; degree must be listed when degrees are restricted", async () => {
    const s = await fresh(d1);
    expect(await result(s, await publishedDrive({ years: [2027] }))).toBe("NOT_ELIGIBLE");
    expect(await result(s, await publishedDrive({ degrees: ["B.Tech"] }))).toBe("NOT_ELIGIBLE");
    expect(await result(s, await publishedDrive({ degrees: ["B.E.", "B.Tech"] }))).toBe("ELIGIBLE");
  });
  it("the result follows the record: re-verified numbers change the outcome, and each change is a new snapshot", async () => {
    const s = await fresh(d1, c1, { cgpa: 6 });
    const drive = await publishedDrive({ minCgpa: 7 });
    expect(await result(s, drive)).toBe("NOT_ELIGIBLE");
    expect(await result(s, drive)).toBe("NOT_ELIGIBLE");       // unchanged: no duplicate snapshot
    await verified(s, c1, { cgpa: 8 });
    expect(await result(s, drive)).toBe("ELIGIBLE");
    const rows = await inspect<{ result: string }>("SELECT result FROM eligibility_evaluations WHERE drive_id = $1 AND student_id = $2 ORDER BY evaluated_at, id", [drive, s.studentId]);
    expect(rows.map((r) => r.result)).toEqual(["NOT_ELIGIBLE", "ELIGIBLE"]);
  });
});

describe("who may ask, and what is stored", () => {
  it("only a student can check, and only against a published or closed drive of their own college", async () => {
    const s = await fresh();
    const published = await publishedDrive();
    const draft = await makeDrive(w.A.officer, driveInput(co, [d1]));
    const other = await makeDrive(w.B.officer, driveInput(await makeCompany(w.B.officer), [await makeDepartment(w.B.admin)]), true);
    for (const who of [null, w.A.officer, w.A.admin, c1, w.pa]) expect(await code(call(who, sql`SELECT eligibility.check_drive(${published}::uuid)`)), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(call(s, sql`SELECT eligibility.check_drive(${draft}::uuid)`))).toBe("22023");
    expect(await code(call(s, sql`SELECT eligibility.check_drive(${other}::uuid)`))).toBe("22023");
  });
  it("the raw engine is not callable by the app, and snapshots are append-only and not writable by the app", async () => {
    const s = await fresh();
    const drive = await publishedDrive();
    expect(await code(call(s, sql`SELECT eligibility.evaluate(${s.studentId}::uuid, ${drive}::uuid)`))).toBe(DENIED);
    await check(s, drive);
    const [e] = await inspect<{ id: string }>("SELECT id FROM eligibility_evaluations WHERE student_id = $1", [s.studentId]);
    await expect(adminWrite("UPDATE eligibility_evaluations SET result = 'ELIGIBLE' WHERE id = $1", [e.id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM eligibility_evaluations WHERE id = $1", [e.id])).rejects.toMatchObject({ code: DENIED });
    for (const q of [sql`INSERT INTO eligibility_evaluations (college_id, drive_id, student_id, result, checks, engine_version, context) VALUES (${s.collegeId}, ${drive}, ${s.studentId}, 'ELIGIBLE', '[]', '1', 'CHECK')`, sql`UPDATE eligibility_evaluations SET result = 'ELIGIBLE'`, sql`DELETE FROM eligibility_evaluations`]) {
      expect(await code(as(s, (t) => q.execute(t)))).toBe(DENIED);
    }
  });
  it("evaluations are visible to the student and their coordinator only — not to other students, other departments, officers, or other colleges", async () => {
    const s = await fresh(); const other = await fresh();
    const drive = await publishedDrive();
    await check(s, drive);
    const seen = async (a: Actor) => (await as(a, (t) => sql<{ student_id: string }>`SELECT student_id FROM eligibility_evaluations`.execute(t))).rows.map((r) => r.student_id);
    expect(await seen(s)).toEqual([s.studentId]);
    expect(await seen(other)).toEqual([]);
    expect(await seen(c1)).toContain(s.studentId);
    expect(await seen(c2)).not.toContain(s.studentId);
    for (const who of [w.A.officer, w.B.admin, w.B.officer]) expect(await seen(who), who.role).toEqual([]);
  });
  it("my_drives lists each visible drive with the caller's own result and registration status", async () => {
    const s = await fresh();
    const drive = await publishedDrive({ minCgpa: 5 });
    await register(s, drive);
    const rows = (await call(s, sql`SELECT * FROM eligibility.my_drives()`)).rows as { drive_id: string; result: string; registration_status: string | null }[];
    expect(rows.find((r) => r.drive_id === drive)).toMatchObject({ result: "ELIGIBLE", registration_status: "REGISTERED" });
    expect(await code(call(w.A.officer, sql`SELECT * FROM eligibility.my_drives()`))).toBe(DENIED);
  });
  it("officers get aggregate counts only, and nobody else may ask", async () => {
    const drive = await publishedDrive({ minCgpa: 7 });
    const good = await fresh(d1, c1, { cgpa: 8 }); const bad = await fresh(d1, c1, { cgpa: 5 }); await fresh(d1, c1, null);
    await register(good, drive);
    const row = (await call(w.A.officer, sql`SELECT * FROM eligibility.drive_counts(${drive}::uuid)`)).rows[0] as { eligible: number; needs_data: number; not_eligible: number; registered: number; withdrawn: number };
    expect(row.eligible).toBeGreaterThanOrEqual(1);
    expect(row.needs_data).toBeGreaterThanOrEqual(1);
    expect(row.registered).toBe(1);
    expect(Object.keys(row).sort()).toEqual(["eligible", "needs_data", "not_eligible", "registered", "withdrawn"]);
    void bad;
    for (const who of [null, good, c1, w.pa]) expect(await code(call(who, sql`SELECT * FROM eligibility.drive_counts(${drive}::uuid)`)), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(call(w.B.officer, sql`SELECT * FROM eligibility.drive_counts(${drive}::uuid)`))).toBe("22023");
  });
});

describe("registration", () => {
  it("an eligible student registers; the registration points at an ELIGIBLE registration-time snapshot", async () => {
    const s = await fresh();
    const drive = await publishedDrive({ minCgpa: 7 });
    const id = ((await register(s, drive)).rows[0] as { id: string }).id;
    const [r] = await inspect<{ status: string; result: string; context: string }>("SELECT r.status, e.result, e.context FROM registrations r JOIN eligibility_evaluations e ON e.id = r.evaluation_id WHERE r.id = $1", [id]);
    expect(r).toEqual({ status: "REGISTERED", result: "ELIGIBLE", context: "REGISTRATION" });
  });
  it("is refused for NOT_ELIGIBLE and NEEDS_DATA students (server re-check; the reason is given) and creates no registration", async () => {
    const low = await fresh(d1, c1, { cgpa: 5 }); const none = await fresh(d1, c1, null);
    const drive = await publishedDrive({ minCgpa: 7 });
    for (const s of [low, none]) {
      await expect(register(s, drive)).rejects.toMatchObject({ code: "22023", message: expect.stringContaining("not eligible") });
      expect(await inspect("SELECT 1 FROM registrations WHERE student_id = $1", [s.studentId])).toHaveLength(0);
    }
  });
  it("is refused after the deadline, for closed, draft and unpublished drives, and for other colleges' drives", async () => {
    const s = await fresh();
    const lapsed = await publishedDrive({ deadline: new Date(Date.now() + 1500).toISOString() });
    expect(await code(register(s, lapsed))).toBe("OK");          // still open
    await new Promise((r) => setTimeout(r, 1800));
    expect(await code(register(s, lapsed))).toBe("22023");
    const closed = await publishedDrive(); await call(w.A.officer, sql`SELECT placement.set_drive_status(${closed}::uuid, 'CLOSED')`);
    expect(await code(register(s, closed))).toBe("22023");
    expect(await code(register(s, await makeDrive(w.A.officer, driveInput(co, [d1]))))).toBe("22023");
    const foreign = await makeDrive(w.B.officer, driveInput(await makeCompany(w.B.officer), [await makeDepartment(w.B.admin)]), true);
    expect(await code(register(s, foreign))).toBe("22023");
  });
  it("only students register or withdraw (anyone else is refused)", async () => {
    const drive = await publishedDrive();
    for (const who of [null, w.A.officer, w.A.admin, c1, w.pa]) {
      expect(await code(register(who, drive)), who?.role ?? "anonymous").toBe(DENIED);
      expect(await code(withdraw(who, drive)), who?.role ?? "anonymous").toBe(DENIED);
    }
  });
  it("a second registration is refused, and parallel attempts yield exactly one row", async () => {
    const s = await fresh(); const drive = await publishedDrive();
    const outcomes = await Promise.all(Array.from({ length: 6 }, () => code(register(s, drive))));
    expect(outcomes.filter((o) => o === "OK")).toHaveLength(1);
    expect(outcomes.filter((o) => o !== "OK").every((o) => o === "23505" || o === "40001" || o === "40P01")).toBe(true);
    expect(await inspect("SELECT 1 FROM registrations WHERE drive_id = $1 AND student_id = $2", [drive, s.studentId])).toHaveLength(1);
    expect(await code(register(s, drive))).toBe("23505");
  });
  it("withdraw then re-register keeps one row, with the full event history", async () => {
    const s = await fresh(); const drive = await publishedDrive();
    await register(s, drive); await withdraw(s, drive);
    expect(await code(withdraw(s, drive))).toBe("22023");
    await register(s, drive);
    const ev = await inspect<{ event: string }>("SELECT e.event FROM registration_events e JOIN registrations r ON r.id = e.registration_id WHERE r.drive_id = $1 AND r.student_id = $2 ORDER BY e.id", [drive, s.studentId]);
    expect(ev.map((e) => e.event)).toEqual(["REGISTERED", "WITHDRAWN", "RE_REGISTERED"]);
    expect(await inspect("SELECT 1 FROM registrations WHERE drive_id = $1 AND student_id = $2", [drive, s.studentId])).toHaveLength(1);
  });
  it("withdrawal is only allowed before the deadline on a published drive", async () => {
    const s = await fresh(); const drive = await publishedDrive();
    await register(s, drive);
    await call(w.A.officer, sql`SELECT placement.set_drive_status(${drive}::uuid, 'CLOSED')`);
    expect(await code(withdraw(s, drive))).toBe("22023");
  });
  it("a drive that has registrations cannot be unpublished; one without can", async () => {
    const s = await fresh(); const drive = await publishedDrive(); const empty = await publishedDrive();
    await register(s, drive);
    expect(await code(call(w.A.officer, sql`SELECT placement.set_drive_status(${drive}::uuid, 'DRAFT')`))).toBe("22023");
    expect(await code(call(w.A.officer, sql`SELECT placement.set_drive_status(${empty}::uuid, 'DRAFT')`))).toBe("OK");
    await withdraw(s, drive);
    expect(await code(call(w.A.officer, sql`SELECT placement.set_drive_status(${drive}::uuid, 'DRAFT')`))).toBe("OK");
  });
  it("registrations are visible to the student, officers and admins of that college only; coordinators see their department's students", async () => {
    const s = await fresh(); const t = await fresh(d2, c2); const drive = await publishedDrive({ departments: [d1, d2] });
    await register(s, drive); await register(t, drive);
    const seen = async (a: Actor) => (await as(a, (q) => sql<{ student_id: string }>`SELECT student_id FROM registrations`.execute(q))).rows.map((r) => r.student_id).sort();
    expect(await seen(s)).toEqual([s.studentId]);
    expect(await seen(c1)).toContain(s.studentId); expect(await seen(c1)).not.toContain(t.studentId);
    expect(await seen(w.A.officer)).toEqual(expect.arrayContaining([s.studentId, t.studentId]));
    for (const who of [w.B.officer, w.B.admin]) expect(await seen(who), who.role).toEqual([]);
    expect(await code(as(s, (q) => sql`UPDATE registrations SET status = 'WITHDRAWN'`.execute(q)))).toBe(DENIED);
    expect(await code(as(s, (q) => sql`DELETE FROM registrations`.execute(q)))).toBe(DENIED);
    await expect(adminWrite("DELETE FROM registrations WHERE student_id = $1", [s.studentId])).rejects.toMatchObject({ code: DENIED });
  });
});

describe("officer view of applicants and résumé access", () => {
  it("the applicant list shows only REGISTERED students of that drive with their verified numbers; only officers may call it", async () => {
    const a = await fresh(d1, c1, { cgpa: 9 }); const b = await fresh(d1, c1, { cgpa: 8 });
    const drive = await publishedDrive();
    await register(a, drive); await register(b, drive); await withdraw(b, drive);
    const rows = (await call(w.A.officer, sql`SELECT * FROM registrations.list_for_drive(${drive}::uuid)`)).rows as { student_id: string; cgpa: string }[];
    expect(rows.map((r) => r.student_id)).toEqual([a.studentId]);
    expect(Number(rows[0].cgpa)).toBe(9);
    for (const who of [null, a, c1, w.A.admin, w.pa]) expect(await code(call(who, sql`SELECT * FROM registrations.list_for_drive(${drive}::uuid)`)), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(call(w.B.officer, sql`SELECT * FROM registrations.list_for_drive(${drive}::uuid)`))).toBe("22023");
  });
  it("an officer can open the résumé of a registered student, but not a mark sheet, nor a résumé of an unregistered student; the access is logged", async () => {
    const reg = await fresh(); const unreg = await fresh();
    const mk = async (s: Actor & { studentId: string }, kind: string) => ((await call(s, sql`SELECT documents.register(${kind}, 'f.pdf', 'application/pdf', 10, ${hex()}, ${`c/${s.collegeId}/s/${s.studentId}/${randomUUID()}`}) AS id`)).rows[0] as { id: string }).id;
    const resume = await mk(reg, "RESUME"); const sheet = await mk(reg, "MARKSHEET"); const otherResume = await mk(unreg, "RESUME");
    const keyOf = (a: Actor, id: string) => call(a, sql`SELECT * FROM documents.storage_key_for(${id}::uuid)`);
    expect(await code(keyOf(w.A.officer, resume))).toBe("22023");           // not registered anywhere yet
    await register(reg, await publishedDrive());
    expect(await code(keyOf(w.A.officer, resume))).toBe("OK");
    expect(await code(keyOf(w.A.officer, sheet))).toBe("22023");
    expect(await code(keyOf(w.A.officer, otherResume))).toBe("22023");
    expect(await code(keyOf(w.B.officer, resume))).toBe("22023");
    const ev = await inspect<{ event: string; actor_role: string }>("SELECT event, actor_role FROM document_events WHERE document_id = $1 AND event = 'ACCESSED'", [resume]);
    expect(ev).toEqual([{ event: "ACCESSED", actor_role: "PLACEMENT_OFFICER" }]);
  });
});
void futureDeadline;

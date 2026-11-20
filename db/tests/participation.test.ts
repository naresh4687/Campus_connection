import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { appDb, closeAppDb, code, driveInput, inspect, makeCompany, makeCoordinator, makeDepartment, makeDrive, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let co: string; let d1: string; let d2: string; let c1: Actor; let c2: Actor;
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, appDb());
const run = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(appDb()));
type Row = { student_id: string; department_code: string; eligibility: string; registration_status: string | null; has_account: boolean };
const part = async (a: Actor, drive: string, dept: string | null = null) => (await run(a, sql`SELECT * FROM registrations.participation(${drive}::uuid, ${dept}::uuid)`)).rows as Row[];
let n = 0;
async function verified(s: Actor, coord: Actor) { const r = (await run(s, sql`SELECT academics.submit(8, 80, 80, null, 0, 0, null) AS id`)).rows[0] as { id: string }; await run(coord, sql`SELECT academics.verify(${r.id}::uuid, null)`); }
const student = async (dept: string, coord: Actor, verify = true) => { const s = await makeStudentIn(w.A.admin, dept, `pt${++n}`); if (verify) await verified(s, coord); return s; };
const drive = async (o: Partial<Parameters<typeof driveInput>[2]> = {}) => makeDrive(w.A.officer, driveInput(co, [d1, d2], o), true);
const notes = async (u: Actor, title: string) => Number((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM notifications WHERE user_id = $1 AND title LIKE $2", [u.userId, `${title}%`]))[0].n);

beforeAll(async () => {
  w = await seedTwoColleges(); co = await makeCompany(w.A.officer); d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin);
  c1 = await makeCoordinator(w.A.admin, [d1], "pc1"); c2 = await makeCoordinator(w.A.admin, [d2], "pc2");
});
afterAll(async () => { await closeAppDb(); });

describe("who has registered", () => {
  it("lists every student of the drive's departments with the engine's result and the registration status; coordinators see only their department", async () => {
    const id = await drive(); const a = await student(d1, c1); const b = await student(d1, c1); const c = await student(d2, c2); const unverified = await student(d1, c1, false);
    await run(a, sql`SELECT registrations.register(${id}::uuid)`);
    const rows = await part(w.A.officer, id); const by = (u: Actor) => rows.find((r) => r.student_id === (u as Actor & { studentId: string }).studentId)!;
    expect(by(a)).toMatchObject({ eligibility: "ELIGIBLE", registration_status: "REGISTERED" });
    expect(by(b)).toMatchObject({ eligibility: "ELIGIBLE", registration_status: null });
    expect(by(unverified)).toMatchObject({ eligibility: "NEEDS_DATA", registration_status: null });
    expect(by(c).department_code).not.toBe(by(a).department_code);
    const mine = await part(c1, id); expect(mine.length).toBeGreaterThan(0); expect(mine.every((r) => r.department_code === by(a).department_code)).toBe(true);
    expect((await part(c1, id, d2)).length).toBe(0);                                          // another department's filter gives a coordinator nothing
    expect((await part(w.A.admin, id)).length).toBe(rows.length);                             // the administrator may read
  });
  it("students, other colleges and anonymous callers are refused; an unpublished drive does not exist for this", async () => {
    const id = await drive(); const draft = await makeDrive(w.A.officer, driveInput(co, [d1]));
    for (const who of [w.A.student, null]) expect(await code(part(who as Actor, id))).toBe("42501");
    expect(await code(part(w.B.officer, id))).toBe("22023");
    expect(await code(part(w.A.officer, draft))).toBe("22023");
    const other = await makeCoordinator(w.A.admin, [await makeDepartment(w.A.admin)], "pc3");
    expect(await code(part(other, id))).toBe("22023");                                        // a coordinator whose departments are not in this drive
  });
});

describe("reminders", () => {
  it("students who are eligible and have not registered are notified; registered ones are not; a student who started an external registration gets a different message", async () => {
    const id = await drive(); const reg = await student(d1, c1); const todo = await student(d1, c1); const nodata = await student(d1, c1, false);
    await run(reg, sql`SELECT registrations.register(${id}::uuid)`);
    expect(await code(run(w.A.student, sql`SELECT registrations.remind_students(${id}::uuid, null)`))).toBe("42501");
    const n1 = (await run(w.A.officer, sql`SELECT registrations.remind_students(${id}::uuid, null) AS n`)).rows[0] as { n: number };
    expect(n1.n).toBeGreaterThanOrEqual(1);
    expect(await notes(todo, "Registration open")).toBe(1); expect(await notes(reg, "Registration open")).toBe(0); expect(await notes(nodata, "Registration open")).toBe(0);
    expect(await code(run(w.A.officer, sql`SELECT registrations.remind_students(${id}::uuid, null)`))).toBe("22023");            // once per six hours
  });
  it("a coordinator can remind only their own department", async () => {
    const id = await drive(); const mine = await student(d1, c1); const theirs = await student(d2, c2);
    expect(await code(run(c1, sql`SELECT registrations.remind_students(${id}::uuid, ${d2}::uuid)`))).toBe("42501");
    await run(c1, sql`SELECT registrations.remind_students(${id}::uuid, null)`);
    expect(await notes(mine, "Registration open")).toBe(1); expect(await notes(theirs, "Registration open")).toBe(0);
  });
  it("a closed or expired drive cannot be reminded", async () => {
    const id = await drive(); await run(w.A.officer, sql`SELECT placement.set_drive_status(${id}::uuid, 'CLOSED')`);
    expect(await code(run(w.A.officer, sql`SELECT registrations.remind_students(${id}::uuid, null)`))).toBe("22023");
  });
  it("an officer (only) tells each department's coordinators how many eligible students have not registered", async () => {
    const id = await drive(); await student(d1, c1); await student(d1, c1); await student(d2, c2);
    for (const who of [c1, w.A.student, w.A.admin]) expect(await code(run(who, sql`SELECT registrations.remind_coordinators(${id}::uuid)`))).toBe("42501");
    const r = (await run(w.A.officer, sql`SELECT registrations.remind_coordinators(${id}::uuid) AS n`)).rows[0] as { n: number }; expect(r.n).toBe(2);
    const titles = await inspect<{ title: string }>("SELECT title FROM notifications WHERE user_id = $1 AND title LIKE '%have not registered' ORDER BY created_at DESC LIMIT 1", [c1.userId]);
    expect(titles[0].title).toMatch(/^\d+ eligible students? of /);
    expect(await code(run(w.A.officer, sql`SELECT registrations.remind_coordinators(${id}::uuid)`))).toBe("22023");
  });
  it("a download is recorded in the audit log, for the caller's own college only", async () => {
    const id = await drive();
    await run(c1, sql`SELECT registrations.log_participation_export(${id}::uuid, 'not-registered', 3)`);
    expect((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM audit_log WHERE action = 'DRIVE_PARTICIPATION_EXPORTED' AND entity_id = $1", [id]))[0].n).toBe("1");
    expect(await code(run(w.B.officer, sql`SELECT registrations.log_participation_export(${id}::uuid, 'all', 1)`))).toBe("22023");
    expect(await code(run(w.A.student, sql`SELECT registrations.log_participation_export(${id}::uuid, 'all', 1)`))).toBe("42501");
  });
});

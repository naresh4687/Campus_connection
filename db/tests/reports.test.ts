import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { appDb, closeAppDb, code, DENIED, driveInput, inspect, makeCompany, makeCoordinator, makeDepartment, makeDrive, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
type Stu = Actor & { studentId: string; regId: string };
let w: World; let d1: string; let d2: string; let coord: Actor; let c1: string; let c2: string;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const officer = () => w.A.officer;
const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const future = () => new Date(Date.now() + 7 * 86400_000).toISOString();
const rows = async <T>(a: Actor | null, fn: string, year: number | null = null) => (await call(a, sql`SELECT * FROM ${sql.raw(fn)}(${year}::int)`)).rows as T[];

async function registered(dept: string, drive: string): Promise<Stu> {
  const s = await makeStudentIn(w.A.admin, dept, `rep${Math.random().toString(36).slice(2, 8)}`);
  const sub = (await call(s, sql`SELECT academics.submit(8, 80, 80, null, 0, 0, null) AS id`)).rows[0] as { id: string };
  await call(coord, sql`SELECT academics.verify(${sub.id}::uuid, null)`);
  const reg = (await call(s, sql`SELECT registrations.register(${drive}::uuid) AS id`)).rows[0] as { id: string };
  return { ...s, regId: reg.id };
}
const setRes = (round: string, regs: string[], result: string) => call(officer(), sql`SELECT rounds.set_results(${round}::uuid, ${sql.raw(`ARRAY[${regs.map((r) => `'${r}'`).join(",")}]::uuid[]`)}, ${result}, null)`);
const selIdOf = async (drive: string, s: Stu) => (await inspect<{ id: string }>("SELECT id FROM selections WHERE drive_id = $1 AND student_id = $2", [drive, s.studentId]))[0].id;
const accept = async (drive: string, s: Stu, ctc: number) => {
  const sel = await selIdOf(drive, s);
  await call(officer(), sql`SELECT offers.issue_offer(${sel}::uuid, ${ctc}::numeric, ${future()}::timestamptz, null)`);
  await call(s, sql`SELECT offers.respond(${sel}::uuid, true)`); return sel;
};
const join = async (sel: string, s: Stu, verify: boolean) => {
  const file = (await call(s, sql`SELECT offers.register_file(${sel}::uuid, 'JOINING_PROOF', 'p.pdf', 'application/pdf', 100, ${hex().slice(0, 64)}, ${`c/${s.collegeId}/o/${sel}/${randomUUID()}`}) AS id`)).rows[0] as { id: string };
  await call(s, sql`SELECT offers.record_joining(${sel}::uuid, ${new Date().toISOString().slice(0, 10)}::date, null, null, ${file.id}::uuid)`);
  if (verify) await call(officer(), sql`SELECT offers.decide_placement(${sel}::uuid, 'VERIFIED', null)`);
};
let sel1 = ""; let sel3 = ""; let s1: Stu; let s2: Stu; let s3: Stu; let s4: Stu; let drive1 = ""; let drive2 = "";

beforeAll(async () => {
  w = await seedTwoColleges();
  c1 = await makeCompany(officer(), "Alpha Systems"); c2 = await makeCompany(officer(), "Beta Works");
  d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin); coord = await makeCoordinator(w.A.admin, [d1, d2], "repc");
  // Drive 1 (company Alpha): s1, s2 in D1; s3 in D2. s2 is rejected. s1 (6 LPA) and s3 (10 LPA) accept; only s1's joining is verified.
  drive1 = await makeDrive(officer(), driveInput(c1, [d1, d2]), true);
  s1 = await registered(d1, drive1); s2 = await registered(d1, drive1); s3 = await registered(d2, drive1); s4 = await registered(d1, drive1);
  const s5 = await registered(d1, drive1); await call(s5, sql`SELECT registrations.withdraw(${drive1}::uuid)`);           // registered, then withdrew: not counted as registered
  await call(officer(), sql`SELECT placement.set_drive_status(${drive1}::uuid, 'CLOSED')`);
  const r1 = ((await call(officer(), sql`SELECT rounds.save_round(null, ${drive1}::uuid, 'Final', 'HR', null, null, null) AS id`)).rows[0] as { id: string }).id;
  await setRes(r1, [s1.regId, s3.regId, s4.regId], "SELECTED"); await setRes(r1, [s2.regId], "REJECTED"); await call(officer(), sql`SELECT rounds.release_round(${r1}::uuid)`);
  await call(officer(), sql`SELECT offers.select_students(${drive1}::uuid, ${sql.raw(`ARRAY['${s1.regId}','${s3.regId}','${s4.regId}']::uuid[]`)})`);
  await call(officer(), sql`SELECT offers.withdraw_offer(${await selIdOf(drive1, s4)}::uuid, 'Candidate withdrew before the offer')`);       // selected, then withdrawn: must not be counted as selected
  sel1 = await accept(drive1, s1, 6); sel3 = await accept(drive1, s3, 10);
  await join(sel1, s1, true); await join(sel3, s3, false);
  // Drive 2 (company Beta): s1 registers too and is withdrawn from selection (never issued).
  drive2 = await makeDrive(officer(), driveInput(c2, [d1, d2]), true);
});
afterAll(async () => { await closeAppDb(); });

type Dept = { code: string; students: number; registered_students: number; selected_students: number; accepted_students: number; placed_students: number };

describe("who may read reports", () => {
  it("only placement officers and college administrators of the college", async () => {
    const calls = ["reports.years()", "reports.department_summary(null)", "reports.drive_summary(null)", "reports.company_summary(null)", "reports.ctc_stats(null)", "reports.placed_students(null)"];
    for (const fn of calls) {
      for (const who of [null, w.A.student, coord, w.A.coordinator, w.pa]) expect(await code(call(who, sql`SELECT * FROM ${sql.raw(fn)}`)), `${fn} ${who?.role ?? "anonymous"}`).toBe(DENIED);
      expect(await code(call(officer(), sql`SELECT * FROM ${sql.raw(fn)}`))).toBe("OK"); expect(await code(call(w.A.admin, sql`SELECT * FROM ${sql.raw(fn)}`))).toBe("OK");
    }
    for (const who of [null, w.A.student, coord, w.pa]) expect(await code(call(who, sql`SELECT reports.log_export('placed', null)`)), who?.role ?? "anonymous").toBe(DENIED);
  });
  it("the other college sees only its own numbers (none of ours)", async () => {
    const b = await rows<Dept>(w.B.officer, "reports.department_summary");
    const rawB = (await inspect<{ n: number }>("SELECT count(*)::int AS n FROM students WHERE college_id = $1", [w.B.officer.collegeId]))[0].n;
    expect(b.reduce((n, r) => n + r.students, 0)).toBe(rawB);                                                       // exactly its own students, none of ours
    expect(b.reduce((n, r) => n + r.placed_students, 0)).toBe(0);
    expect(await rows(w.B.admin, "reports.placed_students")).toHaveLength(0);
    expect((await rows<{ company_name: string }>(w.B.officer, "reports.company_summary")).some((r) => r.company_name === "Alpha Systems")).toBe(false);
    expect((await rows<{ job_title: string; drive_id: string }>(w.B.officer, "reports.drive_summary")).some((r) => r.drive_id === drive1)).toBe(false);
  });
});

describe("the numbers equal the raw data", () => {
  it("department summary: students, registered, selected, accepted, placed — an accepted offer is not a placement", async () => {
    const r = await rows<Dept>(officer(), "reports.department_summary");
    const raw = (id: string) => inspect<{ students: number; placed: number }>(`SELECT count(*)::int AS students, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM placements p WHERE p.student_id = st.id AND p.status = 'VERIFIED'))::int AS placed FROM students st WHERE st.department_id = $1`, [id]);
    const find = async (id: string) => (await inspect<{ code: string }>("SELECT code::text AS code FROM departments WHERE id = $1", [id]))[0].code;
    const byCode = Object.fromEntries(r.map((x) => [x.code, x]));
    const c1code = await find(d1); const c2code = await find(d2);
    expect(byCode[c1code]).toMatchObject({ students: 4, registered_students: 3, selected_students: 1, accepted_students: 1, placed_students: 1 });
    expect(byCode[c2code]).toMatchObject({ students: 1, registered_students: 1, selected_students: 1, accepted_students: 1, placed_students: 0 });   // accepted, joining recorded, NOT verified
    expect((await raw(d1))[0]).toEqual({ students: 4, placed: 1 }); expect((await raw(d2))[0]).toEqual({ students: 1, placed: 0 });
    expect(await rows<Dept>(w.A.admin, "reports.department_summary")).toEqual(r);                                    // administrators see the same
  });
  it("the year filter uses the student's passing year", async () => {
    const none = await rows<Dept>(officer(), "reports.department_summary", 1999);
    expect(none.every((x) => x.students === 0 && x.placed_students === 0)).toBe(true);
    const yr = (await inspect<{ passing_year: number }>("SELECT passing_year FROM students WHERE id = $1", [s1.studentId]))[0].passing_year;
    const same = await rows<Dept>(officer(), "reports.department_summary", yr);
    const rawA = (await inspect<{ n: number }>("SELECT count(*)::int AS n FROM students WHERE college_id = $1 AND passing_year = $2", [officer().collegeId, yr]))[0].n;
    expect(same.reduce((n, x) => n + x.students, 0)).toBe(rawA);
    expect(((await call(officer(), sql`SELECT * FROM reports.years()`)).rows as { passing_year: number }[]).map((x) => x.passing_year)).toContain(yr);
  });
  it("drive summary reconciles with registrations, selections, offers and verified placements", async () => {
    const r = await rows<{ drive_id: string; registered: number; selected: number; offers_issued: number; accepted: number; placed: number; status: string }>(officer(), "reports.drive_summary");
    expect(r.find((x) => x.drive_id === drive1)).toMatchObject({ registered: 4, selected: 2, offers_issued: 2, accepted: 2, placed: 1, status: "CLOSED" });
    expect(r.find((x) => x.drive_id === drive2)).toMatchObject({ registered: 0, selected: 0, offers_issued: 0, accepted: 0, placed: 0, status: "PUBLISHED" });
    expect(r.every((x) => x.placed <= x.accepted && x.accepted <= x.offers_issued && x.offers_issued <= x.selected)).toBe(true);
  });
  it("company summary groups by company", async () => {
    const r = await rows<{ company_name: string; drives: number; selected: number; accepted: number; placed: number }>(officer(), "reports.company_summary");
    expect(r.find((x) => x.company_name === "Alpha Systems")).toMatchObject({ drives: 1, selected: 2, accepted: 2, placed: 1 });
    expect(r.find((x) => x.company_name === "Beta Works")).toMatchObject({ drives: 1, selected: 0, accepted: 0, placed: 0 });
  });
  it("CTC statistics use verified placements only; they move when the second joining is verified", async () => {
    let [c] = await rows<{ placed: number; with_ctc: number; highest: string; average: string; median: string }>(officer(), "reports.ctc_stats");
    expect(c).toMatchObject({ placed: 1, with_ctc: 1 }); expect([Number(c.highest), Number(c.average), Number(c.median)]).toEqual([6, 6, 6]);   // the 10 LPA offer is accepted but NOT verified
    await call(officer(), sql`SELECT offers.decide_placement(${sel3}::uuid, 'VERIFIED', null)`);
    [c] = await rows(officer(), "reports.ctc_stats");
    expect(c).toMatchObject({ placed: 2, with_ctc: 2 }); expect([Number(c.highest), Number(c.average), Number(c.median)]).toEqual([10, 8, 8]);
    const raw = await inspect<{ max: string; avg: string }>("SELECT max(s.offered_ctc_lpa)::text AS max, round(avg(s.offered_ctc_lpa), 2)::text AS avg FROM placements p JOIN selections s ON s.id = p.selection_id WHERE p.status = 'VERIFIED' AND s.college_id = $1", [officer().collegeId]);
    expect([Number(raw[0].max), Number(raw[0].avg)]).toEqual([10, 8]);
    expect((await rows<{ placed: number; highest: string | null }>(w.B.officer, "reports.ctc_stats"))[0]).toMatchObject({ placed: 0, highest: null });   // nothing to average: NULL, not zero
  });
  it("the placed-students list holds exactly the verified placements, with their names", async () => {
    const r = await rows<{ full_name: string; company_name: string; ctc_lpa: string }>(officer(), "reports.placed_students");
    expect(r).toHaveLength(2); expect(r.every((x) => x.company_name === "Alpha Systems" && x.full_name)).toBe(true);
    expect((await rows(officer(), "reports.placed_students", 1999))).toHaveLength(0);
  });
  it("overriding a placement is reflected immediately (single source of truth)", async () => {
    await call(w.A.admin, sql`SELECT offers.override_placement(${sel3}::uuid, 'REJECTED', 'Letter was not genuine')`);
    expect((await rows<{ placed: number }>(officer(), "reports.ctc_stats"))[0].placed).toBe(1);
    expect((await rows(officer(), "reports.placed_students"))).toHaveLength(1);
  });
});

describe("exports are audited", () => {
  it("log_export records the report type and year (no personal data) and refuses unknown reports", async () => {
    expect(await code(call(officer(), sql`SELECT reports.log_export('placed', 2026)`))).toBe("OK");
    expect(await code(call(w.A.admin, sql`SELECT reports.log_export('everything', null)`))).toBe("22023");
    const a = await inspect<{ actor_role: string; metadata: { year: number | null } }>("SELECT actor_role, metadata FROM audit_log WHERE action = 'REPORT_EXPORTED' AND college_id = $1 ORDER BY id DESC LIMIT 1", [officer().collegeId]);
    expect(a[0].actor_role).toBe("PLACEMENT_OFFICER"); expect(a[0].metadata).toEqual({ year: 2026 });
  });
});

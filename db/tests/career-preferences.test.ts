import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { appDb, closeAppDb, code, DENIED, inspect, makeCoordinator, makeDepartment, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let d1: string; let d2: string; let c1: Actor; let s1: Actor & { studentId: string }; let s1b: Actor & { studentId: string }; let s2: Actor & { studentId: string };
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, appDb());
const call = (a: Actor, q: ReturnType<typeof sql>) => as(a, (t) => q.execute(t));
const setPref = (a: Actor, ids: string[], pref: string, reason = "Spoke to the student") => call(a, sql`SELECT students.set_career_preference(${sql`ARRAY[${sql.join(ids.map((i) => sql`${i}::uuid`))}]::uuid[]`}, ${pref}, ${reason}) AS n`);
const prefOf = async (id: string) => (await inspect<{ career_preference: string }>("SELECT career_preference FROM students WHERE id = $1", [id]))[0].career_preference;

beforeAll(async () => {
  w = await seedTwoColleges();
  d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin);
  c1 = await makeCoordinator(w.A.admin, [d1], "cpc1");
  s1 = await makeStudentIn(w.A.admin, d1, "cps1"); s1b = await makeStudentIn(w.A.admin, d1, "cps1b"); s2 = await makeStudentIn(w.A.admin, d2, "cps2");
});
afterAll(async () => { await closeAppDb(); });

describe("career preference", () => {
  it("every student starts Undecided (never placement-interested by default, never blocked)", async () => {
    expect(await prefOf(s1.studentId)).toBe("UNDECIDED");
  });

  it("a coordinator moves students of their own department, with a history row and an audit entry", async () => {
    expect((await setPref(c1, [s1.studentId, s1b.studentId], "PLACEMENT", "Registered interest in the placement briefing")).rows[0]).toEqual({ n: 2 });
    expect(await prefOf(s1.studentId)).toBe("PLACEMENT");
    const h = await inspect<{ previous: string; new_preference: string; reason: string; changed_by: string; changed_by_role: string }>("SELECT * FROM career_preference_history WHERE student_id = $1", [s1.studentId]);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ previous: "UNDECIDED", new_preference: "PLACEMENT", reason: "Registered interest in the placement briefing", changed_by: c1.userId, changed_by_role: "COORDINATOR" });
    expect((await inspect("SELECT 1 FROM audit_log WHERE action = 'CAREER_PREFERENCE_CHANGED' AND actor_user_id = $1", [c1.userId])).length).toBeGreaterThan(0);
  });

  it("a preference can change again and again; the whole path is kept, and the placement path stays open", async () => {
    await setPref(c1, [s1.studentId], "HIGHER_STUDIES", "Plans an MS");
    await setPref(c1, [s1.studentId], "PLACEMENT", "Changed their mind");
    expect(await prefOf(s1.studentId)).toBe("PLACEMENT");
    const h = await inspect<{ previous: string; new_preference: string }>("SELECT previous, new_preference FROM career_preference_history WHERE student_id = $1 ORDER BY id", [s1.studentId]);
    expect(h.map((x) => `${x.previous}>${x.new_preference}`)).toEqual(["UNDECIDED>PLACEMENT", "PLACEMENT>HIGHER_STUDIES", "HIGHER_STUDIES>PLACEMENT"]);
  });

  it("setting the same value changes nothing and writes no history", async () => {
    expect((await setPref(c1, [s1.studentId], "PLACEMENT")).rows[0]).toEqual({ n: 0 });
    expect((await inspect("SELECT 1 FROM career_preference_history WHERE student_id = $1", [s1.studentId])).length).toBe(3);
  });

  it("is all-or-nothing: one student outside the coordinator's departments refuses the whole call", async () => {
    expect(await code(setPref(c1, [s1.studentId, s2.studentId], "OTHER"))).toBe(DENIED);
    expect(await prefOf(s1.studentId)).toBe("PLACEMENT");
    expect(await prefOf(s2.studentId)).toBe("UNDECIDED");
  });

  it("only coordinators may change it: students, officers and administrators are refused; another college's coordinator finds no such student", async () => {
    for (const a of [s1, w.A.officer, w.A.admin]) expect(await code(setPref(a, [s1.studentId], "OTHER"))).toBe(DENIED);
    expect(await code(setPref(w.B.coordinator, [s1.studentId], "OTHER"))).toBe("22023");                    // not found: nothing about college A is revealed
    expect(await prefOf(s1.studentId)).toBe("PLACEMENT");
  });

  it("a coordinator whose assignment ended can no longer change it", async () => {
    const c = await makeCoordinator(w.A.admin, [d1], "cpc-ended");
    await call(w.A.admin, sql`SELECT college.unassign_coordinator(${d1}::uuid, ${c.userId}::uuid)`);
    expect(await code(setPref(c, [s1.studentId], "OTHER"))).toBe(DENIED);
  });

  it("needs a reason, a known category and a sensible list", async () => {
    expect(await code(setPref(c1, [s1.studentId], "OTHER", " "))).toBe("22023");
    expect(await code(setPref(c1, [s1.studentId], "RICH"))).toBe("22023");
    expect(await code(setPref(c1, [], "OTHER"))).toBe("22023");
    expect(await code(setPref(c1, ["00000000-0000-4000-8000-000000000000"], "OTHER"))).toBe("22023");
  });

  it("the history cannot be edited or deleted, by anyone", async () => {
    for (const q of ["UPDATE career_preference_history SET reason = 'x'", "DELETE FROM career_preference_history"]) {
      await expect(inspect(q)).rejects.toThrow();
    }
  });

  it("history and preferences are visible only to those who can see the student", async () => {
    const own = await as(s1, (t) => sql`SELECT count(*)::int AS n FROM career_preference_history`.execute(t));
    expect((own.rows[0] as { n: number }).n).toBe(3);                                                        // a student sees their own history
    const other = await as(s1b, (t) => sql`SELECT count(*)::int AS n FROM career_preference_history WHERE student_id = ${s1.studentId}`.execute(t));
    expect((other.rows[0] as { n: number }).n).toBe(0);                                                      // not another student's
    const cross = await as(w.B.admin, (t) => sql`SELECT count(*)::int AS n FROM career_preference_history`.execute(t));
    expect((cross.rows[0] as { n: number }).n).toBe(0);                                                      // not another college's
    const outside = await as(c1, (t) => sql`SELECT count(*)::int AS n FROM career_preference_history WHERE student_id = ${s2.studentId}`.execute(t));
    expect((outside.rows[0] as { n: number }).n).toBe(0);                                                    // a coordinator sees only their departments
  });

  it("the runtime role cannot write the column or the history directly", async () => {
    for (const q of [sql`UPDATE students SET career_preference = 'PLACEMENT'`, sql`INSERT INTO career_preference_history (college_id, student_id, previous, new_preference, reason, changed_by, changed_by_role) VALUES (gen_random_uuid(), gen_random_uuid(), 'A', 'B', 'xxx', gen_random_uuid(), 'X')`]) {
      expect(await code(call(c1, q))).toBe(DENIED);
    }
  });
});

describe("career categories (college settings)", () => {
  const cats = async (a: Actor) => (await call(a, sql`SELECT * FROM students.career_categories()`)).rows as { code: string; label: string; active: boolean }[];

  it("shows the six built-in categories to everyone in the college", async () => {
    for (const a of [c1, s1, w.A.officer, w.A.admin]) expect((await cats(a)).map((c) => c.code)).toEqual(["PLACEMENT", "HIGHER_STUDIES", "ENTREPRENEURSHIP", "OTHER", "UNDECIDED", "NOT_SEEKING_PLACEMENT"]);
  });
  it("the administrator renames a category for their college only", async () => {
    await call(w.A.admin, sql`SELECT college.set_career_category('OTHER', 'Civil services / other', true)`);
    expect((await cats(c1)).find((c) => c.code === "OTHER")?.label).toBe("Civil services / other");
    expect((await cats(w.B.coordinator)).find((c) => c.code === "OTHER")?.label).toBe("Other career path");
  });
  it("only the administrator configures; Undecided cannot be hidden; a hidden category cannot be assigned but is kept by those who hold it", async () => {
    expect(await code(call(c1, sql`SELECT college.set_career_category('OTHER', 'x y', true)`))).toBe(DENIED);
    expect(await code(call(w.A.admin, sql`SELECT college.set_career_category('UNDECIDED', 'Undecided', false)`))).toBe("22023");
    await setPref(c1, [s1b.studentId], "ENTREPRENEURSHIP");
    await call(w.A.admin, sql`SELECT college.set_career_category('ENTREPRENEURSHIP', 'Entrepreneurship interested', false)`);
    expect(await code(setPref(c1, [s1.studentId], "ENTREPRENEURSHIP"))).toBe("22023");
    expect(await prefOf(s1b.studentId)).toBe("ENTREPRENEURSHIP");
    await call(w.A.admin, sql`SELECT college.set_career_category('ENTREPRENEURSHIP', 'Entrepreneurship interested', true)`);
  });
});

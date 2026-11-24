import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { appDb, closeAppDb, code, DENIED, makeCompany, makeCoordinator, makeDepartment, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let d1: string; let d2: string; let coA: string; let coB: string; let coord: Actor;
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, appDb());
const run = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(appDb()));
const sid = (s: Actor) => (s as Actor & { studentId: string }).studentId;
const U = null as unknown as string;
let n = 0;

/** A verified, accepted, manually recorded placement. */
async function placed(dept: string, company: string, ctc: number, joined: string, degree?: string) {
  const s = await makeStudentIn(w.A.admin, dept, `rf${++n}`);
  if (degree) await as(w.A.admin, (t) => sql`UPDATE students SET degree = ${degree} WHERE id = ${sid(s)}::uuid`.execute(t)).catch(() => undefined);
  const r = (await run(coord, sql`SELECT placement.record_manual_placement(${company}::uuid, ${sid(s)}::uuid, ${ctc}::numeric, ${joined}::date, null, 'ACCEPTED') AS id`)).rows[0] as { id: string };
  await run(w.A.officer, sql`SELECT placement.review_manual_placement(${r.id}::uuid, true, null)`);
  return s;
}
const rows = async (a: Actor, o: { year?: number | null; dept?: string | null; degree?: string | null; company?: string | null; from?: string | null; to?: string | null } = {}) =>
  (await run(a, sql`SELECT student_id, company_name, ctc_lpa, placed_on::text AS placed_on, source, department_code FROM reports.placement_rows(${o.year ?? U}::int, ${o.dept ?? U}::uuid, ${o.degree ?? U}, ${o.company ?? U}::uuid, null::uuid, ${o.from ?? U}::date, ${o.to ?? U}::date)`)).rows as
    { student_id: string; company_name: string; ctc_lpa: string; placed_on: string; source: string; department_code: string }[];

beforeAll(async () => {
  w = await seedTwoColleges(); d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin);
  coA = await makeCompany(w.A.officer, "Alpha Works"); coB = await makeCompany(w.A.officer, "Beta Labs");
  coord = await makeCoordinator(w.A.admin, [d1, d2], "rf-coord");
});
afterAll(async () => { await closeAppDb(); });

describe("who may run the filtered reports", () => {
  it("only placement officers and college administrators of the college", async () => {
    for (const who of [w.A.student, w.A.coordinator, null]) {
      expect(await code(run(who, sql`SELECT * FROM reports.student_pool(null, null, null)`)), who?.role ?? "anon").toBe(DENIED);
      expect(await code(run(who, sql`SELECT * FROM reports.placement_rows(null, null, null, null, null, null, null)`))).toBe(DENIED);
      expect(await code(run(who, sql`SELECT * FROM reports.funnel_rows(null, null, null, null, null, null)`))).toBe(DENIED);
      expect(await code(run(who, sql`SELECT * FROM reports.campus_rounds(null, null)`))).toBe(DENIED);
      expect(await code(run(who, sql`SELECT * FROM reports.filter_options()`))).toBe(DENIED);
    }
    for (const who of [w.A.officer, w.A.admin]) expect(await code(run(who, sql`SELECT * FROM reports.student_pool(null, null, null)`))).toBe("OK");
  });
  it("the other college sees none of our students, placements or companies", async () => {
    const s = await placed(d1, coA, 9, "2026-02-10");
    expect((await rows(w.B.officer)).some((r) => r.student_id === sid(s))).toBe(false);
    expect(((await run(w.B.officer, sql`SELECT * FROM reports.student_pool(null, null, null)`)).rows as { student_id: string }[]).some((r) => r.student_id === sid(s))).toBe(false);
    const opts = (await run(w.B.officer, sql`SELECT * FROM reports.filter_options()`)).rows as { label: string }[];
    expect(opts.some((o) => o.label === "Alpha Works")).toBe(false);
  });
});

describe("filters narrow the placements", () => {
  it("by department, company, date range and CTC; a student placed twice stays one student", async () => {
    const a = await placed(d1, coA, 6, "2026-01-15"); const b = await placed(d2, coB, 14, "2026-03-20"); const c = await placed(d1, coB, 10, "2026-03-25");
    const all = await rows(w.A.officer); const ids = (xs: { student_id: string }[]) => xs.map((x) => x.student_id);
    expect(ids(all)).toEqual(expect.arrayContaining([sid(a), sid(b), sid(c)]));
    expect(ids(await rows(w.A.officer, { dept: d2 }))).toEqual([sid(b)]);
    expect(ids(await rows(w.A.officer, { company: coA })).includes(sid(a))).toBe(true);
    expect((await rows(w.A.officer, { company: coA })).every((r) => r.company_name === "Alpha Works")).toBe(true);
    const march = await rows(w.A.officer, { from: "2026-03-01", to: "2026-03-31" });
    expect(ids(march)).toEqual(expect.arrayContaining([sid(b), sid(c)])); expect(ids(march)).not.toContain(sid(a));
    expect(march.every((r) => r.placed_on >= "2026-03-01" && r.placed_on <= "2026-03-31")).toBe(true);
    expect((await rows(w.A.admin, { dept: d2 })).length).toBe(1);                                       // the administrator sees the same report
    expect(await rows(w.A.officer, { year: 1999 })).toEqual([]);
    expect(all.find((r) => r.student_id === sid(b))).toMatchObject({ ctc_lpa: "14.00", source: "MANUAL" });
  });
  it("a recorded but unverified placement, or one whose offer is not accepted, is not counted", async () => {
    const s = await makeStudentIn(w.A.admin, d1, `rf${++n}`);
    const r = (await run(coord, sql`SELECT placement.record_manual_placement(${coA}::uuid, ${sid(s)}::uuid, 5, null, null, 'ACCEPTED') AS id`)).rows[0] as { id: string };
    expect((await rows(w.A.officer)).some((x) => x.student_id === sid(s))).toBe(false);                 // still pending
    await run(w.A.officer, sql`SELECT placement.review_manual_placement(${r.id}::uuid, true, null)`);
    expect((await rows(w.A.officer)).some((x) => x.student_id === sid(s))).toBe(true);
    const o = await makeStudentIn(w.A.admin, d1, `rf${++n}`);
    const r2 = (await run(coord, sql`SELECT placement.record_manual_placement(${coB}::uuid, ${sid(o)}::uuid, 5, null, null, 'OFFERED') AS id`)).rows[0] as { id: string };
    await run(w.A.officer, sql`SELECT placement.review_manual_placement(${r2.id}::uuid, true, null)`);
    expect((await rows(w.A.officer)).some((x) => x.student_id === sid(o))).toBe(false);                 // offered, not accepted
  });
});

describe("the student pool", () => {
  it("flags who is placed, carries profile links and filters by department", async () => {
    const s = await placed(d2, coA, 8, "2026-02-01");
    await run(s, sql`SELECT students.update_own_links('https://github.com/rf-octo', null, null)`);
    const pool = (await run(w.A.officer, sql`SELECT * FROM reports.student_pool(null, ${d2}::uuid, null)`)).rows as { student_id: string; placed: boolean; github_url: string | null; department_code: string }[];
    expect(pool.find((p) => p.student_id === sid(s))).toMatchObject({ placed: true, github_url: "https://github.com/rf-octo" });
    expect(new Set(pool.map((p) => p.department_code)).size).toBe(1);
    const un = await makeStudentIn(w.A.admin, d2, `rf${++n}`);
    expect(((await run(w.A.officer, sql`SELECT * FROM reports.student_pool(null, ${d2}::uuid, null)`)).rows as { student_id: string; placed: boolean }[]).find((p) => p.student_id === sid(un))?.placed).toBe(false);
  });
  it("the filter options list our departments and only companies we have dealt with", async () => {
    const opts = (await run(w.A.officer, sql`SELECT * FROM reports.filter_options()`)).rows as { kind: string; label: string }[];
    expect(opts.filter((o) => o.kind === "company").map((o) => o.label)).toEqual(expect.arrayContaining(["Alpha Works", "Beta Labs"]));
    expect(opts.filter((o) => o.kind === "department").length).toBeGreaterThanOrEqual(2);
    await makeCompany(w.A.officer, "Never Dealt Ltd");
    expect(((await run(w.A.officer, sql`SELECT * FROM reports.filter_options()`)).rows as { label: string }[]).some((o) => o.label === "Never Dealt Ltd")).toBe(false);
  });
});

describe("export audit", () => {
  it("accepts the new report names and still refuses unknown ones", async () => {
    for (const t of ["unplaced", "campus", "placed"]) expect(await code(run(w.A.officer, sql`SELECT reports.log_export(${t}, 2026)`))).toBe("OK");
    expect(await code(run(w.A.officer, sql`SELECT reports.log_export('everything', 2026)`))).toBe("22023");
  });
});

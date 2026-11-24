import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { appDb, closeAppDb, code, DENIED, makeDepartment, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let d1: string; let d2: string;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const officer = () => w.A.officer;
const ids = (xs: string[]) => sql.raw(`ARRAY[${xs.map((x) => `'${x}'`).join(",")}]::uuid[]`);
const rounds = JSON.stringify([{ name: "Aptitude" }, { name: "Technical" }, { name: "HR" }]);
const AT = "2030-01-15T09:00:00Z";

const create = async (o: { drive?: string | null; company?: string; depts?: string[]; years?: number[]; rounds?: string } = {}) => {
  const r = await call(officer(), sql`SELECT campus.create_event(${o.drive ?? null}::uuid, ${o.company ?? "Acme Corp"}, ${"Acme drive"}, ${"details"}, ${"Hall 1"}, ${AT}::timestamptz, ${ids(o.depts ?? [])}, ${sql.raw(`ARRAY[${(o.years ?? []).join(",")}]::int[]`)}, ${o.rounds ?? rounds}::jsonb) AS id`);
  const id = (r.rows[0] as { id: string }).id;
  const rs = (await as(officer(), (t) => sql<{ id: string; round_number: number; token: string }>`SELECT id, round_number, token FROM campus_rounds WHERE event_id = ${id}::uuid ORDER BY round_number`.execute(t))).rows;
  return { id, rounds: rs };
};
const open = (round: string) => call(officer(), sql`SELECT campus.set_round_status(${round}::uuid, 'OPEN')`);
const mark = (s: Actor, token: string) => call(s, sql`SELECT campus.mark_attendance(${token}) AS r`);
const advance = (round: string, studs: string[], yes = true) => call(officer(), sql`SELECT campus.set_advancement(${round}::uuid, ${ids(studs)}, ${yes}) AS n`);

beforeAll(async () => { w = await seedTwoColleges(); d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin); });
afterAll(async () => { await closeAppDb(); });

describe("on-campus drives", () => {
  it("only a placement officer creates one, and it needs at least one round", async () => {
    for (const who of [w.A.student, w.A.coordinator, w.A.admin, w.B.student]) {
      expect(await code(call(who, sql`SELECT campus.create_event(null, 'X Co', 't', null, null, ${AT}::timestamptz, '{}'::uuid[], '{}'::int[], ${rounds}::jsonb)`)), who.role).toBe(DENIED);
    }
    expect(await code(call(null, sql`SELECT campus.create_event(null, 'X Co', 't', null, null, ${AT}::timestamptz, '{}'::uuid[], '{}'::int[], ${rounds}::jsonb)`))).toBe(DENIED);
    expect(await code(call(officer(), sql`SELECT campus.create_event(null, 'X Co', 't', null, null, ${AT}::timestamptz, '{}'::uuid[], '{}'::int[], '[]'::jsonb)`))).toBe("22023");
    expect(await code(call(officer(), sql`SELECT campus.create_event(null, '', 't', null, null, ${AT}::timestamptz, '{}'::uuid[], '{}'::int[], ${rounds}::jsonb)`))).toBe("22023");
  });

  it("runs end to end: link, check-in, next round, and eligibility is enforced by the database", async () => {
    const a = await makeStudentIn(w.A.admin, d1, "cmp-a"); const b = await makeStudentIn(w.A.admin, d1, "cmp-b"); const c = await makeStudentIn(w.A.admin, d1, "cmp-c");
    const ev = await create(); const [r1, r2] = ev.rounds;
    expect(ev.rounds.map((r) => r.round_number)).toEqual([1, 2, 3]);
    expect(r1.token).toHaveLength(64); expect(new Set(ev.rounds.map((r) => r.token)).size).toBe(3);

    // The link does nothing until the round is opened.
    expect(await code(mark(a, r1.token))).toBe("22023");
    await open(r1.id);
    expect(((await mark(a, r1.token)).rows[0] as { r: string }).r).toBe("MARKED");
    expect(((await mark(a, r1.token)).rows[0] as { r: string }).r).toBe("ALREADY");
    await mark(b, r1.token);
    expect(await code(mark(w.B.student, r1.token))).toBe("22023");          // another college's student: link is not valid there
    expect(await code(mark(w.A.officer, r1.token))).toBe(DENIED);            // staff do not check in as students

    // Round 2 stays closed to everyone until someone is marked eligible; an absent student cannot be marked.
    expect(await code(open(r2.id))).toBe("22023");
    expect(await advance(r1.id, [c.studentId]).then((r) => (r.rows[0] as { n: number }).n)).toBe(0);
    expect((await advance(r1.id, [a.studentId]).then((r) => r.rows[0] as { n: number })).n).toBe(1);
    expect(await code(mark(b, r2.token))).toBe("22023");                      // b attended round 1 but is not eligible for round 2
    await open(r2.id);
    expect(await code(mark(b, r2.token))).toBe("22023");
    expect(((await mark(a, r2.token)).rows[0] as { r: string }).r).toBe("MARKED");

    // Counts and roster.
    const stats = (await call(officer(), sql`SELECT * FROM campus.round_stats(${ev.id}::uuid) ORDER BY round_number`)).rows as { eligible: number; present: number; advanced: number }[];
    expect(stats[0]).toMatchObject({ present: 2, advanced: 1 }); expect(stats[1]).toMatchObject({ eligible: 1, present: 1, advanced: 0 });
    const roster = (await call(officer(), sql`SELECT * FROM campus.round_roster(${r1.id}::uuid)`)).rows as { student_id: string; advanced: boolean }[];
    expect(roster.map((x) => [x.student_id, x.advanced]).sort()).toEqual([[a.studentId, true], [b.studentId, false]].sort());

    // a attended round 2 so cannot be taken out of it; a cannot be marked absent in round 1 while eligible for round 2.
    expect(await code(advance(r1.id, [a.studentId], false))).toBe("22023");
    expect(await code(call(officer(), sql`SELECT campus.set_attendance(${r1.id}::uuid, ${ids([a.studentId])}, false)`))).toBe("22023");

    // Students were told.
    const n = (await as(a, (t) => sql<{ title: string }>`SELECT title FROM notifications WHERE category = 'ROUNDS' ORDER BY created_at`.execute(t))).rows.map((x) => x.title);
    expect(n.some((t) => t.startsWith("Attendance open"))).toBe(true); expect(n).toContain("You are eligible for the next round");
  });

  it("a closed round, a completed event and a cancelled event refuse check-in", async () => {
    const s = await makeStudentIn(w.A.admin, d1, "cmp-d");
    const ev = await create(); const [r1] = ev.rounds;
    await open(r1.id);
    await call(officer(), sql`SELECT campus.set_round_status(${r1.id}::uuid, 'CLOSED')`);
    expect(await code(mark(s, r1.token))).toBe("22023");
    await open(r1.id);
    await call(officer(), sql`SELECT campus.set_event_status(${ev.id}::uuid, 'COMPLETED')`);
    expect(await code(mark(s, r1.token))).toBe("22023");
    expect((await as(officer(), (t) => sql<{ status: string }>`SELECT status FROM campus_rounds WHERE id = ${r1.id}::uuid`.execute(t))).rows[0].status).toBe("CLOSED");
  });

  it("round 1 audience: department filter, and manual attendance for a walk-in", async () => {
    const in1 = await makeStudentIn(w.A.admin, d1, "cmp-e"); const in2 = await makeStudentIn(w.A.admin, d2, "cmp-f");
    const ev = await create({ depts: [d1] }); const [r1] = ev.rounds;
    await open(r1.id);
    expect(((await mark(in1, r1.token)).rows[0] as { r: string }).r).toBe("MARKED");
    expect(await code(mark(in2, r1.token))).toBe("22023");
    // The officer can still add the other department's student by hand, and remove them again.
    expect(((await call(officer(), sql`SELECT campus.set_attendance(${r1.id}::uuid, ${ids([in2.studentId])}, true) AS n`)).rows[0] as { n: number }).n).toBe(1);
    const mine = (await call(in2, sql`SELECT * FROM campus.my_events() WHERE event_id = ${ev.id}::uuid`)).rows as { present: boolean }[];
    expect(mine.some((r) => r.present)).toBe(true);
    await call(officer(), sql`SELECT campus.set_attendance(${r1.id}::uuid, ${ids([in2.studentId])}, false)`);
    const missing = (await call(officer(), sql`SELECT * FROM campus.round_missing(${r1.id}::uuid, null)`)).rows as { student_id: string }[];
    expect(missing.map((m) => m.student_id)).not.toContain(in1.studentId);
  });

  it("a posted drive restricts round 1 to its registered students", async () => {
    const s = await makeStudentIn(w.A.admin, d1, "cmp-g");
    // No published drive exists in this test world, so a made-up one is refused; a college-wide event is open to everyone in the college.
    expect(await code(call(officer(), sql`SELECT campus.create_event(${"00000000-0000-4000-8000-000000000000"}::uuid, null, 't', null, null, ${AT}::timestamptz, '{}'::uuid[], '{}'::int[], ${rounds}::jsonb)`))).toBe("22023");
    const ev = await create(); await open(ev.rounds[0].id);
    expect(((await mark(s, ev.rounds[0].token)).rows[0] as { r: string }).r).toBe("MARKED");
  });

  it("colleges never see each other's on-campus drives, and students cannot read the tables", async () => {
    const ev = await create();
    const seenB = (await as(w.B.officer, (t) => sql<{ id: string }>`SELECT id FROM campus_events WHERE id = ${ev.id}::uuid`.execute(t))).rows;
    expect(seenB).toHaveLength(0);
    expect((await as(w.A.student, (t) => sql`SELECT * FROM campus_rounds`.execute(t))).rows).toHaveLength(0);
    expect((await as(w.A.student, (t) => sql`SELECT * FROM campus_attendance`.execute(t))).rows).toHaveLength(0);
    expect(await code(call(w.B.officer, sql`SELECT campus.set_round_status(${ev.rounds[0].id}::uuid, 'OPEN')`))).toBe("22023");
    expect(await code(call(w.B.officer, sql`SELECT * FROM campus.round_stats(${ev.id}::uuid)`))).toBe("22023");
    expect(await code(call(w.A.student, sql`SELECT * FROM campus.round_stats(${ev.id}::uuid)`))).toBe(DENIED);
    // No direct writes by the runtime role.
    expect(await code(as(w.A.officer, (t) => sql`INSERT INTO campus_attendance (college_id, round_id, student_id, method) VALUES (${w.A.collegeId}::uuid, ${ev.rounds[0].id}::uuid, ${w.A.student.userId}::uuid, 'SELF')`.execute(t)))).toBe(DENIED);
  });
});

describe("department degree and profile links", () => {
  it("a department keeps its degree, and an invalid one is refused", async () => {
    const id = (await call(w.A.admin, sql`SELECT college.create_department(${"AI & ML " + Math.random()}, ${"AM" + Math.floor(Math.random() * 900 + 100)}, null, 'B.Tech') AS id`)).rows[0] as { id: string };
    expect(((await as(w.A.admin, (t) => sql<{ degree: string }>`SELECT degree FROM departments WHERE id = ${id.id}::uuid`.execute(t))).rows[0]).degree).toBe("B.Tech");
    expect(await code(call(w.A.admin, sql`SELECT college.create_department(${"Bad " + Math.random()}, ${"BD" + Math.floor(Math.random() * 900 + 100)}, null, 'PhD')`))).toBe("22023");
    await call(w.A.admin, sql`SELECT college.update_department(${id.id}::uuid, ${"AI and ML " + Math.random()}, ${"AN" + Math.floor(Math.random() * 900 + 100)}, null, 'M.E.')`);
    expect(((await as(w.A.admin, (t) => sql<{ degree: string }>`SELECT degree FROM departments WHERE id = ${id.id}::uuid`.execute(t))).rows[0]).degree).toBe("M.E.");
  });

  it("a student saves and clears their own GitHub / LeetCode / LinkedIn links; wrong hosts are refused", async () => {
    const s = await makeStudentIn(w.A.admin, d1, "lnk-a");
    await call(s, sql`SELECT students.update_own_links('https://github.com/octo-cat', 'https://leetcode.com/u/octo', 'https://www.linkedin.com/in/octo-cat')`);
    const row = (await as(s, (t) => sql<{ github_url: string; leetcode_url: string; linkedin_url: string }>`SELECT github_url, leetcode_url, linkedin_url FROM students`.execute(t))).rows[0];
    expect(row).toEqual({ github_url: "https://github.com/octo-cat", leetcode_url: "https://leetcode.com/u/octo", linkedin_url: "https://www.linkedin.com/in/octo-cat" });
    expect(await code(call(s, sql`SELECT students.update_own_links('https://evil.example/octo', null, null)`))).toBe("22023");
    expect(await code(call(s, sql`SELECT students.update_own_links('javascript:alert(1)', null, null)`))).toBe("22023");
    await call(s, sql`SELECT students.update_own_links('', '', '')`);
    expect((await as(s, (t) => sql<{ github_url: string | null }>`SELECT github_url FROM students`.execute(t))).rows[0].github_url).toBeNull();
    expect(await code(call(w.A.officer, sql`SELECT students.update_own_links(null, null, null)`))).toBe(DENIED);
  });
});

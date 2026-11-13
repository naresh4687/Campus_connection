import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, createCollege, createUser, DENIED, driveInput, futureDeadline, inspect, makeCompany, makeDepartment, makeDrive, makeStudentIn, saveDriveSql, seedTwoColleges, type Actor, type DriveInput } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let co: string; let coB: string; let d1: string; let d2: string; let dB: string;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const save = (a: Actor | null, id: string | null, o: Partial<DriveInput> = {}, base?: DriveInput) => call(a, saveDriveSql(id, { ...(base ?? driveInput(co, [d1])), ...o }));
const mk = (o: Partial<DriveInput> = {}) => makeDrive(w.A.officer, { ...driveInput(co, [d1]), ...o });
const publish = (a: Actor | null, id: string) => call(a, sql`SELECT placement.publish_drive(${id}::uuid)`);
const setStatus = (a: Actor | null, id: string, to: string) => call(a, sql`SELECT placement.set_drive_status(${id}::uuid, ${to})`);
const statusOf = async (id: string) => (await inspect<{ status: string }>("SELECT status FROM drives WHERE id = $1", [id]))[0].status;
const visible = async (a: Actor) => (await as(a, (t) => sql<{ id: string }>`SELECT id FROM drives`.execute(t))).rows.map((r) => r.id).sort();

beforeAll(async () => {
  w = await seedTwoColleges();
  co = await makeCompany(w.A.officer); coB = await makeCompany(w.B.officer);
  d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin); dB = await makeDepartment(w.B.admin);
});
afterAll(async () => { await closeAppDb(); });

describe("who can write drives", () => {
  it("only placement officers can save, publish or change status (every other caller refused)", async () => {
    const id = await mk();
    for (const who of [null, w.A.admin, w.A.coordinator, w.A.student, w.pa]) {
      const n = who?.role ?? "anonymous";
      expect(await code(save(who, null)), `save ${n}`).toBe(DENIED);
      expect(await code(publish(who, id)), `publish ${n}`).toBe(DENIED);
      expect(await code(setStatus(who, id, "ARCHIVED")), `status ${n}`).toBe(DENIED);
    }
  });
  it("the runtime role cannot write drives, criteria or departments directly — even an officer", async () => {
    const id = await mk();
    for (const q of [sql`UPDATE drives SET status = 'PUBLISHED' WHERE id = ${id}`, sql`UPDATE drives SET openings = 999 WHERE id = ${id}`, sql`DELETE FROM drives WHERE id = ${id}`,
      sql`UPDATE drive_criteria SET min_cgpa = 0 WHERE drive_id = ${id}`, sql`DELETE FROM drive_departments WHERE drive_id = ${id}`, sql`DELETE FROM drive_events`]) {
      expect(await code(as(w.A.officer, (t) => q.execute(t)))).toBe(DENIED);
    }
  });
  it("an officer cannot touch another college's drive, and cannot use another college's company or departments", async () => {
    const idB = await makeDrive(w.B.officer, driveInput(coB, [dB]));
    expect(await code(publish(w.A.officer, idB))).toBe("22023");
    expect(await code(setStatus(w.A.officer, idB, "ARCHIVED"))).toBe("22023");
    expect(await code(save(w.A.officer, idB))).toBe("22023");
    expect(await code(save(w.A.officer, null, { company: coB }))).toBe("22023");
    expect(await code(save(w.A.officer, null, { departments: [dB] }))).toBe("22023");
  });
});

describe("saving a draft", () => {
  it("stores content, criteria, normalised years and departments, snapshots the company name, and records history", async () => {
    const id = await mk({ years: [2027, 2026, 2026], degrees: ["B.Tech", "B.E.", "B.E."], departments: [d1, d2], minCgpa: 7.5, minTenth: 60, maxBacklogs: 0, maxArrears: 2 });
    const [d] = await inspect<{ company_name: string; status: string }>("SELECT company_name, status FROM drives WHERE id = $1", [id]);
    expect(d.status).toBe("DRAFT");
    expect(d.company_name).toBe((await inspect<{ name: string }>("SELECT name::text AS name FROM companies WHERE id = $1", [co]))[0].name);
    const [c] = await inspect<{ passing_years: number[]; degrees: string[]; min_cgpa: string; max_active_backlogs: number; min_twelfth: string | null }>("SELECT passing_years, degrees, min_cgpa::text, max_active_backlogs, min_twelfth::text FROM drive_criteria WHERE drive_id = $1", [id]);
    expect(c).toMatchObject({ passing_years: [2026, 2027], degrees: ["B.E.", "B.Tech"], min_cgpa: "7.50", max_active_backlogs: 0, min_twelfth: null });   // unset criterion stays NULL, not zero
    expect((await inspect("SELECT 1 FROM drive_departments WHERE drive_id = $1", [id]))).toHaveLength(2);
    expect((await inspect<{ event: string }>("SELECT event FROM drive_events WHERE drive_id = $1 ORDER BY id", [id])).map((e) => e.event)).toEqual(["CREATED"]);
    await save(w.A.officer, id, { title: "Senior Engineer", departments: [d1] }, driveInput(co, [d1], { departments: [d1] }));
    expect((await inspect<{ job_title: string }>("SELECT job_title FROM drives WHERE id = $1", [id]))[0].job_title).toBe("Senior Engineer");
    expect((await inspect("SELECT 1 FROM drive_departments WHERE drive_id = $1", [id]))).toHaveLength(1);
    expect((await inspect<{ event: string }>("SELECT event FROM drive_events WHERE drive_id = $1 ORDER BY id", [id])).map((e) => e.event)).toEqual(["CREATED", "UPDATED"]);
  });
  const bad: [string, Partial<DriveInput>][] = [
    ["one-letter title", { title: "X" }], ["unknown employment type", { type: "VOLUNTEER" }], ["negative CTC", { ctc: -1 }], ["absurd CTC", { ctc: 5000 }], ["zero openings", { openings: 0 }],
    ["CGPA above 10", { minCgpa: 10.5 }], ["negative percentage", { minTenth: -1 }], ["percentage above 100", { minTwelfth: 101 }], ["backlogs above 50", { maxBacklogs: 51 }],
    ["year out of range", { years: [1800] }], ["too many years", { years: [2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028, 2029, 2030] }], ["unknown degree", { degrees: ["PhD"] }], ["over-long description", { description: "d".repeat(4001) }],
  ];
  for (const [label, o] of bad) it(`rejects ${label}`, async () => { expect(await code(save(w.A.officer, null, o)), label).toBe("22023"); });
  it("refuses an inactive company, inactive or duplicate departments", async () => {
    const dead = await makeCompany(w.A.officer);
    await as(w.A.officer, (t) => sql`SELECT placement.set_company_status(${dead}::uuid, 'INACTIVE')`.execute(t));
    expect(await code(save(w.A.officer, null, { company: dead }))).toBe("22023");
    const off = await makeDepartment(w.A.admin);
    await as(w.A.admin, (t) => sql`SELECT college.set_department_status(${off}::uuid, 'INACTIVE')`.execute(t));
    expect(await code(save(w.A.officer, null, { departments: [off] }))).toBe("22023");
    expect(await code(save(w.A.officer, null, { departments: [d1, d1] }))).toBe("22023");
  });
});

describe("publishing", () => {
  it("lists every missing prerequisite and publishes nothing", async () => {
    const empty = await mk({ departments: [], years: [], openings: null, deadline: null });
    await expect(publish(w.A.officer, empty)).rejects.toThrow(/openings are missing.*deadline.*department.*passing year/);
    expect(await statusOf(empty)).toBe("DRAFT");
    const past = await mk({ deadline: new Date(Date.now() - 3600_000).toISOString() });
    await expect(publish(w.A.officer, past)).rejects.toThrow(/deadline must be in the future/);
    const noDept = await mk({ departments: [] }); expect(await code(publish(w.A.officer, noDept))).toBe("22023");
    const noYear = await mk({ years: [] });       expect(await code(publish(w.A.officer, noYear))).toBe("22023");
  });
  it("refuses when the company or an eligible department became inactive after drafting", async () => {
    const c2 = await makeCompany(w.A.officer); const dep = await makeDepartment(w.A.admin);
    const id = await makeDrive(w.A.officer, driveInput(c2, [dep]));
    await as(w.A.officer, (t) => sql`SELECT placement.set_company_status(${c2}::uuid, 'INACTIVE')`.execute(t));
    await expect(publish(w.A.officer, id)).rejects.toThrow(/company is inactive/);
    await as(w.A.officer, (t) => sql`SELECT placement.set_company_status(${c2}::uuid, 'ACTIVE')`.execute(t));
    await as(w.A.admin, (t) => sql`SELECT college.set_department_status(${dep}::uuid, 'INACTIVE')`.execute(t));
    await expect(publish(w.A.officer, id)).rejects.toThrow(/department is inactive/);
  });
  it("a complete draft publishes once; the publisher and time are recorded; publishing again is refused; parallel publishes → one", async () => {
    const id = await mk();
    const res = await Promise.all(Array.from({ length: 5 }, () => code(publish(w.A.officer, id))));
    expect(res.filter((r) => r === "OK")).toHaveLength(1);
    const [d] = await inspect<{ status: string; published_by: string; published_at: Date }>("SELECT status, published_by, published_at FROM drives WHERE id = $1", [id]);
    expect(d).toMatchObject({ status: "PUBLISHED", published_by: w.A.officer.userId });
    expect(await code(publish(w.A.officer, id))).toBe("22023");
    expect(await inspect("SELECT 1 FROM audit_log WHERE action = 'DRIVE_PUBLISHED' AND entity_id = $1", [id])).toHaveLength(1);
  });
});

describe("a published drive is frozen", () => {
  it("cannot be edited through the function, and the database refuses content, criteria and department changes even when bypassing it", async () => {
    const id = await mk(); await publish(w.A.officer, id);
    expect(await code(save(w.A.officer, id, { title: "Changed" }))).toBe("22023");
    for (const stmt of ["UPDATE drives SET job_title = 'Changed' WHERE id = $1", "UPDATE drives SET openings = 99 WHERE id = $1", "UPDATE drives SET application_deadline = now() + interval '90 days' WHERE id = $1",
      "UPDATE drive_criteria SET min_cgpa = 0 WHERE drive_id = $1", "DELETE FROM drive_departments WHERE drive_id = $1", "UPDATE drive_criteria SET passing_years = '{2030}' WHERE drive_id = $1"]) {
      await expect(adminWrite(stmt, [id]), stmt).rejects.toMatchObject({ code: DENIED });
    }
    await expect(adminWrite("DELETE FROM drives WHERE id = $1", [id])).rejects.toMatchObject({ code: expect.stringMatching(/^(42501)$/) });
  });
  it("unpublishing returns it to an editable draft", async () => {
    const id = await mk(); await publish(w.A.officer, id);
    await setStatus(w.A.officer, id, "DRAFT");
    expect(await code(save(w.A.officer, id, { title: "Edited after unpublish" }))).toBe("OK");
  });
});

describe("lifecycle (DRAFT → PUBLISHED → CLOSED → ARCHIVED)", () => {
  it("allows exactly the legal moves through the function", async () => {
    const id = await mk();
    expect(await code(setStatus(w.A.officer, id, "CLOSED"))).toBe("22023");          // DRAFT -> CLOSED
    expect(await code(setStatus(w.A.officer, id, "DRAFT"))).toBe("22023");           // DRAFT -> DRAFT
    await publish(w.A.officer, id);
    await setStatus(w.A.officer, id, "CLOSED");
    expect(await code(setStatus(w.A.officer, id, "DRAFT"))).toBe("22023");           // CLOSED -> DRAFT
    expect(await code(publish(w.A.officer, id))).toBe("22023");                      // CLOSED -> PUBLISHED
    await setStatus(w.A.officer, id, "ARCHIVED");
    for (const to of ["DRAFT", "CLOSED", "ARCHIVED"]) expect(await code(setStatus(w.A.officer, id, to)), `ARCHIVED -> ${to}`).toBe("22023");
    expect(await code(setStatus(w.A.officer, id, "PUBLISHED"))).toBe("22023");
    const draft = await mk(); await setStatus(w.A.officer, draft, "ARCHIVED");      // a draft may be discarded
    expect(await statusOf(draft)).toBe("ARCHIVED");
  });
  it("the database refuses illegal transitions even when written directly", async () => {
    const a = await mk();
    await expect(adminWrite("UPDATE drives SET status = 'CLOSED' WHERE id = $1", [a])).rejects.toMatchObject({ code: DENIED });
    await publish(w.A.officer, a); await setStatus(w.A.officer, a, "CLOSED"); await setStatus(w.A.officer, a, "ARCHIVED");
    await expect(adminWrite("UPDATE drives SET status = 'DRAFT' WHERE id = $1", [a])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("UPDATE drives SET status = 'PUBLISHED' WHERE id = $1", [a])).rejects.toMatchObject({ code: DENIED });
  });
  it("records every change in an append-only history and the audit log", async () => {
    const id = await mk(); await publish(w.A.officer, id); await setStatus(w.A.officer, id, "DRAFT"); await publish(w.A.officer, id); await setStatus(w.A.officer, id, "CLOSED"); await setStatus(w.A.officer, id, "ARCHIVED");
    expect((await inspect<{ event: string }>("SELECT event FROM drive_events WHERE drive_id = $1 ORDER BY id", [id])).map((e) => e.event)).toEqual(["CREATED", "PUBLISHED", "UNPUBLISHED", "PUBLISHED", "CLOSED", "ARCHIVED"]);
    await expect(adminWrite("UPDATE drive_events SET event = 'CREATED' WHERE drive_id = $1", [id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM drive_events WHERE drive_id = $1", [id])).rejects.toMatchObject({ code: DENIED });
    expect((await inspect<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action LIKE 'DRIVE_%'", [id]))[0].n).toBe(6);
  });
});

describe("who can see drives (row level security)", () => {
  it("officers and admins see every status; students and coordinators see only PUBLISHED and CLOSED; nobody sees another college's", async () => {
    const draft = await mk(); const pub = await mk(); await publish(w.A.officer, pub);
    const closed = await mk(); await publish(w.A.officer, closed); await setStatus(w.A.officer, closed, "CLOSED");
    const archived = await mk(); await setStatus(w.A.officer, archived, "ARCHIVED");
    const idB = await makeDrive(w.B.officer, driveInput(coB, [dB]), true);
    for (const who of [w.A.officer, w.A.admin]) { const s = await visible(who); expect(s).toEqual(expect.arrayContaining([draft, pub, closed, archived])); expect(s).not.toContain(idB); }
    for (const who of [w.A.student, w.A.coordinator]) {
      const s = await visible(who);
      expect(s).toEqual(expect.arrayContaining([pub, closed]));
      for (const hidden of [draft, archived, idB]) expect(s, who.role).not.toContain(hidden);
    }
    expect(await visible(w.B.student)).toContain(idB);
    expect(await visible(w.B.student)).not.toContain(pub);
    expect(await visible(w.pa)).toEqual([]);
    expect((await sql`SELECT 1 FROM drives`.execute(db())).rows).toEqual([]);
  });
  it("unpublishing hides a drive from students immediately; criteria and departments follow the drive's visibility", async () => {
    const id = await mk({ minCgpa: 7 }); await publish(w.A.officer, id);
    const crit = async (who: Actor) => (await as(who, (t) => sql`SELECT 1 FROM drive_criteria WHERE drive_id = ${id}`.execute(t))).rows.length;
    const deps = async (who: Actor) => (await as(who, (t) => sql`SELECT 1 FROM drive_departments WHERE drive_id = ${id}`.execute(t))).rows.length;
    expect([await crit(w.A.student), await deps(w.A.student)]).toEqual([1, 1]);
    await setStatus(w.A.officer, id, "DRAFT");
    expect([await crit(w.A.student), await deps(w.A.student), await crit(w.A.coordinator)]).toEqual([0, 0, 0]);
    expect([await crit(w.A.officer), await deps(w.A.admin)]).toEqual([1, 1]);
  });
  it("drive history is visible to officers and admins only", async () => {
    const id = await mk(); await publish(w.A.officer, id);
    const n = async (who: Actor) => (await as(who, (t) => sql`SELECT 1 FROM drive_events WHERE drive_id = ${id}`.execute(t))).rows.length;
    expect(await n(w.A.officer)).toBe(2); expect(await n(w.A.admin)).toBe(2);
    for (const who of [w.A.student, w.A.coordinator, w.B.officer, w.pa]) expect(await n(who), who.role).toBe(0);
  });
});

describe("suspended college", () => {
  it("loses all drive authority and regains it on reactivation", async () => {
    const cid = await createCollege();
    const admin = await createUser(w.pa, "COLLEGE_ADMIN", cid, "sdrv");
    const officer = await createUser(admin, "PLACEMENT_OFFICER", cid, "sdrv-o");
    const dep = await makeDepartment(admin); const c = await makeCompany(officer);
    const id = await makeDrive(officer, driveInput(c, [dep]));
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'SUSPENDED', 'suspended for the test')`.execute(t));
    expect(await code(publish(null, id))).toBe(DENIED);
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'ACTIVE', null)`.execute(t));
    expect(await code(publish(officer, id))).toBe("OK");
    void futureDeadline; void makeStudentIn;
  });
});

describe("AI helper audit", () => {
  it("only officers can log a use; only counts are accepted and stored (never text)", async () => {
    const log = (a: Actor | null, c = 500, acc = 4, ign = 1) => call(a, sql`SELECT placement.log_ai_extraction(${c}::int, ${acc}::int, ${ign}::int)`);
    for (const who of [null, w.A.admin, w.A.coordinator, w.A.student, w.pa]) expect(await code(log(who)), who?.role ?? "anonymous").toBe(DENIED);
    for (const bad of [[0, 1, 1], [8001, 1, 1], [100, -1, 0], [100, 31, 0], [100, 0, 99]]) expect(await code(log(w.A.officer, bad[0], bad[1], bad[2])), bad.join()).toBe("22023");
    expect(await code(log(w.A.officer))).toBe("OK");
    const [a] = await inspect<{ actor_role: string; metadata: Record<string, number> }>("SELECT actor_role, metadata FROM audit_log WHERE action = 'AI_EXTRACTION_USED' AND college_id = $1 ORDER BY id DESC LIMIT 1", [w.A.officer.collegeId]);
    expect(a).toEqual({ actor_role: "PLACEMENT_OFFICER", metadata: { chars: 500, accepted: 4, ignored: 1 } });
  });
});

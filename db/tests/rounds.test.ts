import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, DENIED, driveInput, inspect, makeCompany, makeCoordinator, makeDepartment, makeDrive, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
type Stu = Actor & { studentId: string };
let w: World; let co: string; let d1: string; let coord: Actor;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const officer = () => w.A.officer;
let n = 0;

/** A verified student registered for the drive. */
async function registered(drive: string): Promise<Stu & { regId: string }> {
  const s = await makeStudentIn(w.A.admin, d1, `rnd${++n}`);
  const sub = (await call(s, sql`SELECT academics.submit(8, 80, 80, null, 0, 0, null) AS id`)).rows[0] as { id: string };
  await call(coord, sql`SELECT academics.verify(${sub.id}::uuid, null)`);
  const reg = (await call(s, sql`SELECT registrations.register(${drive}::uuid) AS id`)).rows[0] as { id: string };
  return { ...s, regId: reg.id };
}
const newDrive = (publish = true) => makeDrive(officer(), driveInput(co, [d1]), publish);
const close = (drive: string) => call(officer(), sql`SELECT placement.set_drive_status(${drive}::uuid, 'CLOSED')`);
/** A closed drive with `k` registered students. */
async function closedDrive(k: number) {
  const drive = await newDrive(); const studs = []; for (let i = 0; i < k; i++) studs.push(await registered(drive)); await close(drive);
  return { drive, studs };
}
const saveRound = (a: Actor | null, drive: string, o: { id?: string | null; name?: string; kind?: string; at?: string | null; venue?: string | null; instr?: string | null } = {}) =>
  call(a, sql`SELECT rounds.save_round(${o.id ?? null}::uuid, ${drive}::uuid, ${o.name ?? "Online test"}, ${o.kind ?? "APTITUDE"}, ${o.at ?? null}::timestamptz, ${o.venue ?? null}, ${o.instr ?? null}) AS id`);
const mkRound = async (drive: string, o: Parameters<typeof saveRound>[2] = {}) => ((await saveRound(officer(), drive, o)).rows[0] as { id: string }).id;
const setRes = (a: Actor | null, round: string, regs: string[], result: string, note: string | null = null) =>
  call(a, sql`SELECT rounds.set_results(${round}::uuid, ${sql.raw(`ARRAY[${regs.map((r) => `'${r}'`).join(",")}]::uuid[]`)}, ${result}, ${note}) AS n`);
const release = (a: Actor | null, round: string) => call(a, sql`SELECT rounds.release_round(${round}::uuid)`);
const roster = (a: Actor | null, round: string) => call(a, sql`SELECT * FROM rounds.roster(${round}::uuid)`);
const resultsSeen = async (a: Actor) => (await as(a, (t) => sql<{ registration_id: string; result: string }>`SELECT registration_id, result FROM round_results`.execute(t))).rows;
const roundsSeen = async (a: Actor) => (await as(a, (t) => sql<{ id: string }>`SELECT id FROM drive_rounds`.execute(t))).rows.map((r) => r.id);

beforeAll(async () => {
  w = await seedTwoColleges();
  co = await makeCompany(officer()); d1 = await makeDepartment(w.A.admin); coord = await makeCoordinator(w.A.admin, [d1], "rndc");
});
afterAll(async () => { await closeAppDb(); });

describe("who may write", () => {
  it("only placement officers create rounds, record or release results, or delete rounds; the runtime role cannot write the tables directly", async () => {
    const { drive, studs } = await closedDrive(1);
    const round = await mkRound(drive);
    for (const who of [null, w.A.admin, w.A.coordinator, studs[0], w.pa]) {
      const nm = who?.role ?? "anonymous";
      expect(await code(saveRound(who, drive)), `save ${nm}`).toBe(DENIED);
      expect(await code(setRes(who, round, [studs[0].regId], "SELECTED")), `set ${nm}`).toBe(DENIED);
      expect(await code(release(who, round)), `release ${nm}`).toBe(DENIED);
      expect(await code(call(who, sql`SELECT rounds.delete_round(${round}::uuid)`)), `delete ${nm}`).toBe(DENIED);
    }
    for (const q of [sql`UPDATE round_results SET result = 'SELECTED'`, sql`INSERT INTO drive_rounds (college_id, drive_id, round_number, name, kind) VALUES (${officer().collegeId}, ${drive}, 9, 'x', 'HR')`, sql`UPDATE drive_rounds SET released_at = now()`, sql`DELETE FROM drive_rounds`, sql`DELETE FROM round_result_events`]) {
      expect(await code(as(officer(), (t) => q.execute(t)))).toBe(DENIED);
    }
  });
  it("another college's officer cannot touch this college's drive or round", async () => {
    const { drive, studs } = await closedDrive(1); const round = await mkRound(drive);
    expect(await code(saveRound(w.B.officer, drive))).toBe("22023");
    expect(await code(saveRound(w.B.officer, drive, { id: round }))).toBe("22023");
    expect(await code(setRes(w.B.officer, round, [studs[0].regId], "SELECTED"))).toBe("22023");
    expect(await code(release(w.B.officer, round))).toBe("22023");
    expect(await code(call(w.B.officer, sql`SELECT rounds.delete_round(${round}::uuid)`))).toBe("22023");
  });
});

describe("rounds", () => {
  it("exist only for published or closed drives, are numbered in order, and are validated", async () => {
    const draft = await newDrive(false);
    expect(await code(saveRound(officer(), draft))).toBe("22023");
    const drive = await newDrive();
    const r1 = await mkRound(drive, { name: "  Aptitude  " }); const r2 = await mkRound(drive, { name: "Technical", kind: "TECHNICAL", venue: "Lab 2", instr: "Bring ID" });
    const rows = await inspect<{ round_number: number; name: string; venue: string | null }>("SELECT round_number, name, venue FROM drive_rounds WHERE drive_id = $1 ORDER BY round_number", [drive]);
    expect(rows).toEqual([{ round_number: 1, name: "Aptitude", venue: null }, { round_number: 2, name: "Technical", venue: "Lab 2" }]);
    expect(await code(saveRound(officer(), drive, { name: "   " }))).toBe("22023");
    expect(await code(saveRound(officer(), drive, { kind: "WHATEVER" }))).toBe("22023");
    expect(await code(saveRound(officer(), drive, { id: r1, name: "Aptitude test" }))).toBe("OK");       // edit while unreleased
    void r2;
  });
  it("only the last unreleased round without results can be deleted", async () => {
    const { drive, studs } = await closedDrive(1);
    const r1 = await mkRound(drive); const r2 = await mkRound(drive);
    expect(await code(call(officer(), sql`SELECT rounds.delete_round(${r1}::uuid)`))).toBe("22023");      // not the last
    expect(await code(call(officer(), sql`SELECT rounds.delete_round(${r2}::uuid)`))).toBe("OK");
    await setRes(officer(), r1, [studs[0].regId], "SELECTED");
    expect(await code(call(officer(), sql`SELECT rounds.delete_round(${r1}::uuid)`))).toBe("22023");      // has results
  });
});

describe("recording results", () => {
  it("is refused while registration is still open; allowed once the drive is closed", async () => {
    const drive = await newDrive(); const s = await registered(drive); const round = await mkRound(drive);
    expect(await code(setRes(officer(), round, [s.regId], "SELECTED"))).toBe("22023");
    await close(drive);
    expect(await code(setRes(officer(), round, [s.regId], "SELECTED"))).toBe("OK");
  });
  it("only candidates can be given a result: registered students — not withdrawn, not unregistered, not from another drive", async () => {
    const drive = await newDrive(); const a = await registered(drive); const b = await registered(drive);
    await call(b, sql`SELECT registrations.withdraw(${drive}::uuid)`);
    const other = await newDrive(); const o = await registered(other);
    await close(drive); const round = await mkRound(drive);
    expect(await code(setRes(officer(), round, [b.regId], "SELECTED"))).toBe("22023");
    expect(await code(setRes(officer(), round, [o.regId], "SELECTED"))).toBe("22023");
    expect(await code(setRes(officer(), round, [randomUuid()], "SELECTED"))).toBe("22023");
    expect(await code(setRes(officer(), round, [a.regId], "MAYBE"))).toBe("22023");
    expect(await code(setRes(officer(), round, [], "SELECTED"))).toBe("22023");
    expect(await code(setRes(officer(), round, [a.regId], "SELECTED"))).toBe("OK");
    expect((await roster(officer(), round)).rows.map((r) => (r as { registration_id: string }).registration_id)).toEqual([a.regId]);
  });
  it("can be changed freely before release; every change is in an append-only history with the remark, and an unchanged result adds nothing", async () => {
    const { drive, studs } = await closedDrive(2); const round = await mkRound(drive);
    const [a, b] = studs;
    expect(((await setRes(officer(), round, [a.regId, b.regId], "SELECTED")).rows[0] as { n: number }).n).toBe(2);
    expect(((await setRes(officer(), round, [a.regId], "SELECTED")).rows[0] as { n: number }).n).toBe(0);      // same result: no event
    await setRes(officer(), round, [b.regId], "REJECTED", "failed the cut-off");
    await setRes(officer(), round, [b.regId], "ABSENT");
    const ev = await inspect<{ from_result: string | null; to_result: string; note: string | null; actor_name: string }>("SELECT from_result, to_result, note, actor_name FROM round_result_events WHERE registration_id = $1 ORDER BY id", [b.regId]);
    expect(ev.map((e) => [e.from_result, e.to_result, e.note])).toEqual([[null, "SELECTED", null], ["SELECTED", "REJECTED", "failed the cut-off"], ["REJECTED", "ABSENT", null]]);
    expect(ev[0].actor_name).toBeTruthy();
    await expect(adminWrite("UPDATE round_result_events SET note = 'x'")).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM round_result_events")).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM round_results WHERE round_id = $1", [round])).rejects.toMatchObject({ code: DENIED });
    expect(await code(setRes(officer(), round, [a.regId], "SELECTED", "x".repeat(501)))).toBe("22023");
  });
});

describe("release", () => {
  it("is refused while any candidate has no decision (and says how many), or there are no candidates; succeeds once, then freezes everything", async () => {
    const { drive, studs } = await closedDrive(2); const round = await mkRound(drive);
    await expect(release(officer(), round)).rejects.toThrow(/2 student\(s\) still have no decision/);
    await setRes(officer(), round, [studs[0].regId], "SELECTED");
    await expect(release(officer(), round)).rejects.toThrow(/1 student\(s\) still have no decision/);
    await setRes(officer(), round, [studs[1].regId], "PENDING");
    await expect(release(officer(), round)).rejects.toThrow(/1 student\(s\)/);                                // PENDING is not a decision
    await setRes(officer(), round, [studs[1].regId], "REJECTED");
    expect(await code(release(officer(), round))).toBe("OK");
    expect(await code(release(officer(), round))).toBe("22023");                                               // already released
    expect(await code(setRes(officer(), round, [studs[0].regId], "REJECTED"))).toBe("22023");
    expect(await code(saveRound(officer(), drive, { id: round, name: "renamed" }))).toBe("22023");
    expect(await code(call(officer(), sql`SELECT rounds.delete_round(${round}::uuid)`))).toBe("22023");
    for (const q of ["UPDATE round_results SET result = 'SELECTED' WHERE round_id = $1", "DELETE FROM round_results WHERE round_id = $1", "UPDATE drive_rounds SET name = 'x' WHERE id = $1", "UPDATE drive_rounds SET released_at = NULL, released_by = NULL WHERE id = $1", "DELETE FROM drive_rounds WHERE id = $1"]) {
      await expect(adminWrite(q, [round]), q).rejects.toMatchObject({ code: DENIED });
    }
    const [r] = await inspect<{ released_by: string }>("SELECT released_by FROM drive_rounds WHERE id = $1", [round]);
    expect(r.released_by).toBe(officer().userId);
    const empty = await closedDrive(0);
    expect(await code(release(officer(), await mkRound(empty.drive)))).toBe("22023");
  });
  it("round 2 needs round 1 released first, and only students SELECTED in round 1 are its candidates", async () => {
    const { drive, studs } = await closedDrive(3); const r1 = await mkRound(drive); const r2 = await mkRound(drive, { name: "HR", kind: "HR" });
    await expect(setRes(officer(), r2, [studs[0].regId], "SELECTED")).rejects.toThrow(/Release the previous round before recording/);   // round 1 not released
    await expect(release(officer(), r2)).rejects.toThrow(/Release the previous round first/);
    await setRes(officer(), r1, [studs[0].regId, studs[1].regId], "SELECTED"); await setRes(officer(), r1, [studs[2].regId], "REJECTED");
    await release(officer(), r1);
    expect((await roster(officer(), r2)).rows.map((r) => (r as { registration_id: string }).registration_id).sort()).toEqual([studs[0].regId, studs[1].regId].sort());
    expect(await code(setRes(officer(), r2, [studs[2].regId], "SELECTED"))).toBe("22023");                      // rejected in round 1
    expect(await code(setRes(officer(), r2, [studs[0].regId], "SELECTED"))).toBe("OK");
  });
});

describe("who can see what", () => {
  it("the decision history (with student names and remarks) is for staff only", async () => {
    const { drive, studs } = await closedDrive(1); const round = await mkRound(drive); await setRes(officer(), round, [studs[0].regId], "REJECTED", "late arrival");
    const hist = (a: Actor | null) => call(a, sql`SELECT * FROM rounds.history(${drive}::uuid)`);
    const rows = (await hist(officer())).rows as { full_name: string; to_result: string; note: string | null }[];
    expect(rows).toHaveLength(1); expect(rows[0]).toMatchObject({ to_result: "REJECTED", note: "late arrival" }); expect(rows[0].full_name).toBeTruthy();
    expect((await hist(w.A.admin)).rows).toHaveLength(1);
    for (const who of [null, studs[0], coord, w.pa]) expect(await code(hist(who)), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(hist(w.B.officer))).toBe("22023");
  });
  it("a student sees nothing of a round's results before release, and only their own after; schedules are visible to registered students only", async () => {
    const { drive, studs } = await closedDrive(2); const outsider = await (async () => { const s = await makeStudentIn(w.A.admin, d1, `rnd${++n}`); return s; })();
    const round = await mkRound(drive, { at: new Date(Date.now() + 86400_000).toISOString(), venue: "Hall A" });
    await setRes(officer(), round, [studs[0].regId], "SELECTED"); await setRes(officer(), round, [studs[1].regId], "REJECTED");
    expect(await resultsSeen(studs[0])).toEqual([]); expect(await resultsSeen(studs[1])).toEqual([]);          // unreleased: hidden at the database
    expect(await roundsSeen(studs[0])).toContain(round);                                                         // the schedule is visible
    expect(await roundsSeen(outsider)).not.toContain(round);
    await release(officer(), round);
    expect(await resultsSeen(studs[0])).toEqual([{ registration_id: studs[0].regId, result: "SELECTED" }]);
    expect(await resultsSeen(studs[1])).toEqual([{ registration_id: studs[1].regId, result: "REJECTED" }]);
    expect(await resultsSeen(outsider)).toEqual([]);
  });
  it("a withdrawn student no longer sees the drive's rounds; coordinators and the other college see nothing; officers and admins see everything of their college; remarks are never student-visible", async () => {
    const drive = await newDrive(); const a = await registered(drive); const b = await registered(drive); await call(b, sql`SELECT registrations.withdraw(${drive}::uuid)`); await close(drive);
    const round = await mkRound(drive); await setRes(officer(), round, [a.regId], "SELECTED", "strong interview");
    expect(await roundsSeen(b)).not.toContain(round);
    for (const who of [w.A.coordinator, coord, w.B.officer, w.B.admin]) { expect(await roundsSeen(who), who.role).not.toContain(round); expect((await resultsSeen(who)).length, who.role).toBe(0); }
    for (const who of [officer(), w.A.admin]) { expect(await roundsSeen(who), who.role).toContain(round); expect((await resultsSeen(who)).some((r) => r.registration_id === a.regId), who.role).toBe(true); }
    const events = async (who: Actor) => (await as(who, (t) => sql`SELECT note FROM round_result_events`.execute(t))).rows;
    expect((await events(officer())).length).toBeGreaterThan(0);
    for (const who of [a, b, coord, w.B.officer]) expect(await events(who), who.role).toEqual([]);
  });
  it("the roster is for staff only and shows the college's candidates with their current decision", async () => {
    const { drive, studs } = await closedDrive(2); const round = await mkRound(drive); await setRes(officer(), round, [studs[0].regId], "ABSENT");
    const rows = (await roster(officer(), round)).rows as { registration_id: string; result: string }[];
    expect(rows.find((r) => r.registration_id === studs[0].regId)?.result).toBe("ABSENT");
    expect(rows.find((r) => r.registration_id === studs[1].regId)?.result).toBe("PENDING");
    expect((await roster(w.A.admin, round)).rows).toHaveLength(2);
    for (const who of [null, studs[0], coord, w.pa]) expect(await code(roster(who, round)), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(roster(w.B.officer, round))).toBe("22023");
  });
});
function randomUuid() { return "00000000-0000-4000-8000-000000000001"; }

import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, DENIED, driveInput, inspect, makeCompany, makeCoordinator, makeDepartment, makeDrive, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
type Stu = Actor & { studentId: string; regId: string };
let w: World; let co: string; let d1: string; let coord: Actor;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const officer = () => w.A.officer;
const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const future = (ms = 7 * 86400_000) => new Date(Date.now() + ms).toISOString();
let n = 0;

async function registered(drive: string): Promise<Stu> {
  const s = await makeStudentIn(w.A.admin, d1, `off${++n}`);
  const sub = (await call(s, sql`SELECT academics.submit(8, 80, 80, null, 0, 0, null) AS id`)).rows[0] as { id: string };
  await call(coord, sql`SELECT academics.verify(${sub.id}::uuid, null)`);
  const reg = (await call(s, sql`SELECT registrations.register(${drive}::uuid) AS id`)).rows[0] as { id: string };
  return { ...s, regId: reg.id };
}
const setRes = (round: string, regs: string[], result: string) => call(officer(), sql`SELECT rounds.set_results(${round}::uuid, ${sql.raw(`ARRAY[${regs.map((r) => `'${r}'`).join(",")}]::uuid[]`)}, ${result}, null)`);
/** A closed drive with one released round; students at index < selectedCount are SELECTED, the rest REJECTED. */
async function readyDrive(k: number, selectedCount = k) {
  const drive = await makeDrive(officer(), driveInput(co, [d1]), true);
  const studs: Stu[] = []; for (let i = 0; i < k; i++) studs.push(await registered(drive));
  await call(officer(), sql`SELECT placement.set_drive_status(${drive}::uuid, 'CLOSED')`);
  const round = ((await call(officer(), sql`SELECT rounds.save_round(null, ${drive}::uuid, 'Final interview', 'HR', null, null, null) AS id`)).rows[0] as { id: string }).id;
  if (selectedCount > 0) await setRes(round, studs.slice(0, selectedCount).map((s) => s.regId), "SELECTED");
  if (selectedCount < k) await setRes(round, studs.slice(selectedCount).map((s) => s.regId), "REJECTED");
  await call(officer(), sql`SELECT rounds.release_round(${round}::uuid)`);
  return { drive, studs, round };
}
const selectRegs = (a: Actor | null, drive: string, regs: string[]) => call(a, sql`SELECT offers.select_students(${drive}::uuid, ${sql.raw(`ARRAY[${regs.map((r) => `'${r}'`).join(",")}]::uuid[]`)}) AS n`);
/** drive + students that already have a selection row (offer NOT_ISSUED). */
async function selected(k = 1) {
  const r = await readyDrive(k); await selectRegs(officer(), r.drive, r.studs.map((s) => s.regId));
  const sels = await Promise.all(r.studs.map(async (s) => (await inspect<{ id: string }>("SELECT id FROM selections WHERE drive_id = $1 AND student_id = $2", [r.drive, s.studentId]))[0].id));
  return { ...r, sels };
}
const issue = (a: Actor | null, sel: string, o: { ctc?: number | null; deadline?: string | null; letter?: string | null } = {}) =>
  call(a, sql`SELECT offers.issue_offer(${sel}::uuid, ${o.ctc === undefined ? 6.5 : o.ctc}::numeric, ${o.deadline === undefined ? future() : o.deadline}::timestamptz, ${o.letter ?? null}::uuid)`);
const respond = (a: Actor | null, sel: string, accept: boolean) => call(a, sql`SELECT offers.respond(${sel}::uuid, ${accept}) AS r`);
const withdraw = (a: Actor | null, sel: string, reason = "Candidate failed background check") => call(a, sql`SELECT offers.withdraw_offer(${sel}::uuid, ${reason})`);
const status = async (sel: string) => (await inspect<{ offer_status: string }>("SELECT offer_status FROM selections WHERE id = $1", [sel]))[0].offer_status;
const fileKey = (c: string, sel: string) => `c/${c}/o/${sel}/${randomUUID()}`;
const regFile = (a: Actor | null, sel: string, kind: string, key?: string) =>
  call(a, sql`SELECT offers.register_file(${sel}::uuid, ${kind}, 'file.pdf', 'application/pdf', 1000, ${hex().slice(0, 64)}, ${key ?? fileKey(w.A.admin.collegeId!, sel)}) AS id`);
const mkFile = async (a: Actor, sel: string, kind: string) => ((await regFile(a, sel, kind)).rows[0] as { id: string }).id;
const accepted = async () => { const x = await selected(1); await issue(officer(), x.sels[0]); await respond(x.studs[0], x.sels[0], true); return { sel: x.sels[0], stu: x.studs[0], drive: x.drive }; };
const joining = (a: Actor | null, sel: string, file: string, date = "2020-01-01") => call(a, sql`SELECT offers.record_joining(${sel}::uuid, ${date}::date, 'Engineer', null, ${file}::uuid) AS id`);
const decide = (a: Actor | null, sel: string, d: string, reason: string | null = null) => call(a, sql`SELECT offers.decide_placement(${sel}::uuid, ${d}, ${reason})`);
const override = (a: Actor | null, sel: string, d: string, reason: string | null = "Verified against the original joining letter") => call(a, sql`SELECT offers.override_placement(${sel}::uuid, ${d}, ${reason})`);
const funnel = async (a: Actor) => (await call(a, sql`SELECT * FROM offers.funnel()`)).rows[0] as { selected: number; offers_issued: number; offers_accepted: number; joining_recorded: number; placements_verified: number };

beforeAll(async () => {
  w = await seedTwoColleges();
  co = await makeCompany(officer()); d1 = await makeDepartment(w.A.admin); coord = await makeCoordinator(w.A.admin, [d1], "offc");
});
afterAll(async () => { await closeAppDb(); });

describe("selection", () => {
  it("only officers select; only students SELECTED in the final released round qualify; duplicates and other colleges are refused", async () => {
    const r = await readyDrive(3, 2);
    for (const who of [null, w.A.admin, w.A.coordinator, r.studs[0], w.pa]) {
      expect(await code(selectRegs(who, r.drive, [r.studs[0].regId])), who?.role ?? "anonymous").toBe(DENIED);
      expect(await code(call(who, sql`SELECT * FROM offers.select_candidates(${r.drive}::uuid)`)), who?.role ?? "anonymous").toBe(DENIED);
    }
    const cands = (await call(officer(), sql`SELECT registration_id FROM offers.select_candidates(${r.drive}::uuid)`)).rows.map((x) => (x as { registration_id: string }).registration_id).sort();
    expect(cands).toEqual([r.studs[0].regId, r.studs[1].regId].sort());
    expect(await code(selectRegs(officer(), r.drive, [r.studs[2].regId]))).toBe("22023");                        // rejected in the round
    expect(await code(selectRegs(officer(), r.drive, []))).toBe("22023");
    expect(await code(selectRegs(w.B.officer, r.drive, [r.studs[0].regId]))).toBe("22023");
    expect(((await selectRegs(officer(), r.drive, [r.studs[0].regId])).rows[0] as { n: number }).n).toBe(1);
    expect(await code(selectRegs(officer(), r.drive, [r.studs[0].regId]))).toBe("22023");                        // already selected
    const left = (await call(officer(), sql`SELECT registration_id FROM offers.select_candidates(${r.drive}::uuid)`)).rows;
    expect(left).toHaveLength(1);
    expect((await inspect<{ offer_status: string }>("SELECT offer_status FROM selections WHERE student_id = $1", [r.studs[0].studentId]))[0].offer_status).toBe("NOT_ISSUED");
  });
  it("nothing can be selected while a round is unreleased or when there are no rounds", async () => {
    const drive = await makeDrive(officer(), driveInput(co, [d1]), true); const s = await registered(drive);
    await call(officer(), sql`SELECT placement.set_drive_status(${drive}::uuid, 'CLOSED')`);
    expect(await code(selectRegs(officer(), drive, [s.regId]))).toBe("22023");                                   // no rounds
    const r1 = ((await call(officer(), sql`SELECT rounds.save_round(null, ${drive}::uuid, 'R1', 'HR', null, null, null) AS id`)).rows[0] as { id: string }).id;
    await setRes(r1, [s.regId], "SELECTED"); await call(officer(), sql`SELECT rounds.release_round(${r1}::uuid)`);
    await call(officer(), sql`SELECT rounds.save_round(null, ${drive}::uuid, 'R2', 'HR', null, null, null)`);    // a further round that is not released
    expect(await code(selectRegs(officer(), drive, [s.regId]))).toBe("22023");
  });
});

describe("issuing an offer", () => {
  it("only officers; only from NOT_ISSUED; needs a future deadline within 120 days and a sane CTC", async () => {
    const x = await selected(1); const sel = x.sels[0];
    for (const who of [null, w.A.admin, w.A.coordinator, x.studs[0], w.pa]) expect(await code(issue(who, sel)), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(issue(w.B.officer, sel))).toBe("22023");
    expect(await code(issue(officer(), sel, { deadline: future(-1000) }))).toBe("22023");
    expect(await code(issue(officer(), sel, { deadline: null }))).toBe("22023");
    expect(await code(issue(officer(), sel, { deadline: future(121 * 86400_000) }))).toBe("22023");
    expect(await code(issue(officer(), sel, { ctc: 0 }))).toBe("22023");
    expect(await code(issue(officer(), sel, { ctc: 5000 }))).toBe("22023");
    expect(await code(issue(officer(), sel, { letter: randomUUID() }))).toBe("22023");
    expect(await status(sel)).toBe("NOT_ISSUED");
    expect(await code(issue(officer(), sel))).toBe("OK");
    expect(await status(sel)).toBe("ISSUED");
    expect(await code(issue(officer(), sel))).toBe("22023");                                                       // already issued
  });
  it("an offer letter must be this selection's own OFFER_LETTER file", async () => {
    const a = await selected(1); const b = await selected(1);
    const letterB = await mkFile(officer(), b.sels[0], "OFFER_LETTER");
    expect(await code(issue(officer(), a.sels[0], { letter: letterB }))).toBe("22023");
    const letterA = await mkFile(officer(), a.sels[0], "OFFER_LETTER");
    expect(await code(issue(officer(), a.sels[0], { letter: letterA }))).toBe("OK");
  });
  it("the response deadline can be extended (later only) while the offer is awaiting a response", async () => {
    const x = await selected(1); const sel = x.sels[0];
    const extend = (a: Actor | null, d: string) => call(a, sql`SELECT offers.extend_deadline(${sel}::uuid, ${d}::timestamptz)`);
    expect(await code(extend(officer(), future()))).toBe("22023");                                                // not issued yet
    await issue(officer(), sel, { deadline: future(2 * 86400_000) });
    expect(await code(extend(officer(), future(86400_000)))).toBe("22023");                                       // earlier than current
    expect(await code(extend(x.studs[0], future(5 * 86400_000)))).toBe(DENIED);
    expect(await code(extend(officer(), future(5 * 86400_000)))).toBe("OK");
    await respond(x.studs[0], sel, true);
    expect(await code(extend(officer(), future(9 * 86400_000)))).toBe("22023");                                   // answered
  });
});

describe("the student's response", () => {
  it("only the student the offer is for can accept or decline; only once; only while ISSUED", async () => {
    const x = await selected(2); const [s1, s2] = x.studs; const [a, b] = x.sels;
    expect(await code(respond(s1, a, true))).toBe("22023");                                                        // NOT_ISSUED
    await issue(officer(), a); await issue(officer(), b);
    for (const who of [null, officer(), w.A.admin, coord, w.pa]) expect(await code(respond(who, a, true)), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(respond(s2, a, true))).toBe("22023");                                                        // someone else's offer
    expect(await code(respond(w.B.student, a, true))).toBe("22023");
    expect(((await respond(s1, a, true)).rows[0] as { r: string }).r).toBe("ACCEPTED");
    expect(await code(respond(s1, a, false))).toBe("22023");                                                       // no changing your mind
    expect(((await respond(s2, b, false)).rows[0] as { r: string }).r).toBe("DECLINED");
    expect(await code(respond(s2, b, true))).toBe("22023");
    const ev = await inspect<{ event: string; actor_role: string }>("SELECT event, actor_role FROM selection_events WHERE selection_id = $1 ORDER BY id", [a]);
    expect(ev.map((e) => e.event)).toEqual(["SELECTED", "OFFER_ISSUED", "ACCEPTED"]);
    expect(ev[2].actor_role).toBe("STUDENT");
  });
  it("is refused after the response deadline", async () => {
    const x = await selected(1);
    await issue(officer(), x.sels[0], { deadline: new Date(Date.now() + 1200).toISOString() });
    expect(await code(respond(x.studs[0], x.sels[0], true))).toBe("OK".replace("OK", "OK"));                      // still open
    const y = await selected(1);
    await issue(officer(), y.sels[0], { deadline: new Date(Date.now() + 1200).toISOString() });
    await new Promise((r) => setTimeout(r, 1500));
    await expect(respond(y.studs[0], y.sels[0], true)).rejects.toThrow(/deadline .* has passed/);
    expect(await status(y.sels[0])).toBe("ISSUED");
  });
  it("simultaneous answers cannot both succeed: exactly one of eight parallel accept/decline calls wins and the state matches it", async () => {
    const x = await selected(1); await issue(officer(), x.sels[0]);
    const outcomes = await Promise.all(Array.from({ length: 8 }, (_, i) => respond(x.studs[0], x.sels[0], i % 2 === 0).then((r) => (r.rows[0] as { r: string }).r, (e: { code?: string }) => `ERR:${e.code}`)));
    const wins = outcomes.filter((o) => !o.startsWith("ERR"));
    expect(wins).toHaveLength(1);
    expect(outcomes.filter((o) => o.startsWith("ERR")).every((o) => o === "ERR:22023")).toBe(true);
    expect(await status(x.sels[0])).toBe(wins[0]);
    expect(await inspect("SELECT 1 FROM selection_events WHERE selection_id = $1 AND event IN ('ACCEPTED','DECLINED')", [x.sels[0]])).toHaveLength(1);
  });
});

describe("the response race (deterministic)", () => {
  it("while one answer is still uncommitted, a second answer waits for it and is then refused (the row lock, not luck)", async () => {
    const x = await selected(1); await issue(officer(), x.sels[0]);
    const first = as(x.studs[0], async (t) => { await sql`SELECT offers.respond(${x.sels[0]}::uuid, true)`.execute(t); await new Promise((r) => setTimeout(r, 700)); });
    await new Promise((r) => setTimeout(r, 200));
    const started = Date.now();
    const second = code(respond(x.studs[0], x.sels[0], false));
    await first;
    expect(await second).toBe("22023");
    expect(Date.now() - started).toBeGreaterThan(300);                      // it really did wait for the first transaction
    expect(await status(x.sels[0])).toBe("ACCEPTED");
  });
});

describe("withdrawing an offer", () => {
  it("needs a reason; works from NOT_ISSUED, ISSUED and ACCEPTED; never from DECLINED or WITHDRAWN; a withdrawn offer cannot be answered", async () => {
    const x = await selected(4); const [a, b, c, d] = x.sels;
    expect(await code(withdraw(officer(), a, "no"))).toBe("22023");
    for (const who of [null, w.A.admin, x.studs[0], coord]) expect(await code(withdraw(who, a)), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(withdraw(officer(), a))).toBe("OK");                                                          // NOT_ISSUED
    await issue(officer(), b); expect(await code(withdraw(officer(), b))).toBe("OK");                               // ISSUED
    expect(await code(respond(x.studs[1], b, true))).toBe("22023");
    await issue(officer(), c); await respond(x.studs[2], c, true); expect(await code(withdraw(officer(), c))).toBe("OK");   // ACCEPTED
    await issue(officer(), d); await respond(x.studs[3], d, false); expect(await code(withdraw(officer(), d))).toBe("22023");  // DECLINED is final
    expect(await code(withdraw(officer(), a))).toBe("22023");
    const [row] = await inspect<{ withdrawal_reason: string; withdrawn_by: string }>("SELECT withdrawal_reason, withdrawn_by FROM selections WHERE id = $1", [a]);
    expect(row).toEqual({ withdrawal_reason: "Candidate failed background check", withdrawn_by: officer().userId });
  });
});

describe("private offer letters and joining proofs", () => {
  it("an officer attaches a letter; a student attaches joining proof only after accepting; keys must belong to the selection", async () => {
    const x = await selected(1); const sel = x.sels[0]; const stu = x.studs[0];
    expect(await code(regFile(officer(), sel, "OFFER_LETTER"))).toBe("OK");
    expect(await code(regFile(stu, sel, "OFFER_LETTER"))).toBe(DENIED);                                              // students do not upload letters
    expect(await code(regFile(officer(), sel, "JOINING_PROOF"))).toBe(DENIED);                                       // officers do not upload proofs
    for (const who of [null, w.A.admin, coord, w.pa]) expect(await code(regFile(who, sel, "OFFER_LETTER")), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(regFile(stu, sel, "JOINING_PROOF"))).toBe("22023");                                            // not accepted yet
    await issue(officer(), sel); await respond(stu, sel, true);
    expect(await code(regFile(stu, sel, "JOINING_PROOF"))).toBe("OK");
    expect(await code(regFile(officer(), sel, "OFFER_LETTER"))).toBe("22023");                                       // answered: no new letter
    for (const key of [fileKey(w.A.admin.collegeId!, randomUUID()), `c/${randomUUID()}/o/${sel}/${randomUUID()}`, `c/${w.A.admin.collegeId}/s/${stu.studentId}/${randomUUID()}`, "x", `c/${w.A.admin.collegeId}/o/${sel}/not-a-uuid`]) {
      expect(await code(regFile(stu, sel, "JOINING_PROOF", key)), key).toBe("22023");
    }
    const other = await selected(1); await issue(officer(), other.sels[0]); await respond(other.studs[0], other.sels[0], true);
    expect(await code(regFile(other.studs[0], sel, "JOINING_PROOF"))).toBe("22023");                                 // someone else's selection
  });
  it("downloads: the owner, officers and admins can resolve a file; others cannot; non-owner access is audited; storage keys are unreadable by the app", async () => {
    const x = await selected(1); const sel = x.sels[0]; const stu = x.studs[0]; const letter = await mkFile(officer(), sel, "OFFER_LETTER");
    const key = (a: Actor | null) => call(a, sql`SELECT * FROM offers.file_key_for(${letter}::uuid)`);
    expect(await code(key(stu))).toBe("OK"); expect(await code(key(officer()))).toBe("OK"); expect(await code(key(w.A.admin))).toBe("OK");
    expect(await code(key(null))).toBe(DENIED); expect(await code(key(coord))).toBe(DENIED); expect(await code(key(w.pa))).toBe(DENIED);
    expect(await code(key(w.B.officer))).toBe("22023"); expect(await code(key(w.B.student))).toBe("22023");
    const other = await selected(1);
    expect(await code(key(other.studs[0]))).toBe("22023");
    const audit = await inspect<{ actor_role: string }>("SELECT actor_role FROM audit_log WHERE action = 'PLACEMENT_FILE_ACCESSED' AND entity_id = $1 ORDER BY id", [sel]);
    expect(audit.map((a) => a.actor_role)).toEqual(["PLACEMENT_OFFICER", "COLLEGE_ADMIN"]);                           // the owner's own access is not logged
    for (const who of [stu, officer(), w.A.admin]) {
      expect(await code(as(who, (t) => sql`SELECT storage_key FROM selection_files`.execute(t))), who.role).toBe(DENIED);
      expect(await code(as(who, (t) => sql`SELECT * FROM selection_files`.execute(t))), who.role).toBe(DENIED);
    }
    expect((await as(stu, (t) => sql`SELECT id, kind, original_name FROM selection_files`.execute(t))).rows).toHaveLength(1);
  });
});

describe("joining and verified placements", () => {
  it("an accepted offer is NOT a placement; joining needs evidence and a real date; the officer verifies; only then does it count", async () => {
    const before = await funnel(officer());
    const { sel, stu } = await accepted();
    let f = await funnel(officer());
    expect([f.selected - before.selected, f.offers_issued - before.offers_issued, f.offers_accepted - before.offers_accepted, f.placements_verified - before.placements_verified]).toEqual([1, 1, 1, 0]);
    const proof = await mkFile(stu, sel, "JOINING_PROOF");
    expect(await code(joining(stu, sel, randomUUID()))).toBe("22023");                                                // no such evidence
    expect(await code(joining(stu, sel, proof, "2999-01-01"))).toBe("22023");                                         // future date
    expect(await code(joining(stu, sel, proof, "2001-01-01"))).toBe("22023");                                         // before the offer existed
    for (const who of [null, officer(), w.A.admin, coord, w.pa]) expect(await code(joining(who, sel, proof, "2999-01-01")), who?.role ?? "anonymous").toBe(DENIED);
    const today = new Date().toISOString().slice(0, 10);
    expect(await code(joining(stu, sel, proof, today))).toBe("OK");
    expect(await code(joining(stu, sel, proof, today))).toBe("22023");                                                // already recorded
    f = await funnel(officer());
    expect([f.joining_recorded - before.joining_recorded, f.placements_verified - before.placements_verified]).toEqual([1, 0]);   // recorded, still not a placement
    for (const who of [null, stu, w.A.admin, coord, w.pa]) expect(await code(decide(who, sel, "VERIFIED")), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(decide(w.B.officer, sel, "VERIFIED"))).toBe("22023");
    expect(await code(decide(officer(), sel, "REJECTED", "no"))).toBe("22023");
    expect(await code(decide(officer(), sel, "VERIFIED"))).toBe("OK");
    f = await funnel(officer());
    expect(f.placements_verified - before.placements_verified).toBe(1);
    expect(await code(decide(officer(), sel, "REJECTED", "changed my mind"))).toBe("22023");                          // decided
    expect((await funnel(w.A.admin)).placements_verified).toBe(f.placements_verified);
  });
  it("a student's evidence must be their own joining proof for this offer, not another student's file or the officer's letter", async () => {
    const x = await selected(1); const letter = await mkFile(officer(), x.sels[0], "OFFER_LETTER");           // the officer's own letter on the same selection
    await issue(officer(), x.sels[0], { letter }); await respond(x.studs[0], x.sels[0], true);
    const a = { sel: x.sels[0], stu: x.studs[0] }; const b = await accepted();
    const bProof = await mkFile(b.stu, b.sel, "JOINING_PROOF");
    expect(await code(joining(a.stu, a.sel, bProof, new Date().toISOString().slice(0, 10)))).toBe("22023");
    expect(await code(joining(a.stu, a.sel, letter, new Date().toISOString().slice(0, 10)))).toBe("22023");
  });
  it("a rejected record can be corrected and resubmitted; the history keeps every step", async () => {
    const { sel, stu } = await accepted(); const today = new Date().toISOString().slice(0, 10);
    const p1 = await mkFile(stu, sel, "JOINING_PROOF"); await joining(stu, sel, p1, today);
    await decide(officer(), sel, "REJECTED", "The document is unreadable");
    const p2 = await mkFile(stu, sel, "JOINING_PROOF");
    expect(await code(joining(stu, sel, p2, today))).toBe("OK");
    expect((await inspect<{ status: string; decision_reason: string | null }>("SELECT status, decision_reason FROM placements WHERE selection_id = $1", [sel]))[0]).toEqual({ status: "PENDING_VERIFICATION", decision_reason: null });
    await decide(officer(), sel, "VERIFIED");
    expect((await inspect<{ event: string }>("SELECT event FROM selection_events WHERE selection_id = $1 AND event LIKE 'JOINING%' OR selection_id = $1 AND event LIKE 'PLACEMENT%' ORDER BY id", [sel])).map((e) => e.event))
      .toEqual(["JOINING_RECORDED", "PLACEMENT_REJECTED", "JOINING_RECORDED", "PLACEMENT_VERIFIED"]);
  });
  it("a verified placement blocks withdrawal until the administrator overrides; overrides need a real reason, are flagged, and only administrators can make them", async () => {
    const { sel, stu } = await accepted(); const today = new Date().toISOString().slice(0, 10);
    await joining(stu, sel, await mkFile(stu, sel, "JOINING_PROOF"), today); await decide(officer(), sel, "VERIFIED");
    await expect(withdraw(officer(), sel)).rejects.toThrow(/verified placement/);
    for (const who of [null, officer(), stu, coord, w.pa]) expect(await code(override(who, sel, "REJECTED")), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(override(w.B.admin, sel, "REJECTED"))).toBe("22023");
    expect(await code(override(w.A.admin, sel, "REJECTED", "too short"))).toBe("22023");
    expect(await code(override(w.A.admin, sel, "VERIFIED"))).toBe("22023");                                           // already verified
    const before = (await funnel(officer())).placements_verified;
    expect(await code(override(w.A.admin, sel, "REJECTED"))).toBe("OK");
    expect((await funnel(officer())).placements_verified).toBe(before - 1);
    expect((await inspect<{ status: string; overridden: boolean }>("SELECT status, overridden FROM placements WHERE selection_id = $1", [sel]))[0]).toEqual({ status: "REJECTED", overridden: true });
    expect(await code(withdraw(officer(), sel))).toBe("OK");
    expect(await code(override(w.A.admin, sel, "VERIFIED"))).toBe("22023");                                           // offer withdrawn: cannot verify
    const ev = await inspect<{ event: string; actor_role: string }>("SELECT event, actor_role FROM selection_events WHERE event LIKE 'OVERRIDE%' AND selection_id = $1", [sel]);
    expect(ev).toEqual([{ event: "OVERRIDE_REJECTED", actor_role: "COLLEGE_ADMIN" }]);
  });
  it("a joining record cannot be verified once the offer was withdrawn", async () => {
    const { sel, stu } = await accepted(); const today = new Date().toISOString().slice(0, 10);
    await joining(stu, sel, await mkFile(stu, sel, "JOINING_PROOF"), today);
    await withdraw(officer(), sel);
    await expect(decide(officer(), sel, "VERIFIED")).rejects.toThrow(/no longer accepted/);
  });
});

describe("who can see what, and what cannot be changed", () => {
  it("students see only their own selections, files and placements; coordinators and other colleges see nothing; events are staff-only", async () => {
    const x = await selected(2); const [s1, s2] = x.studs;
    await issue(officer(), x.sels[0]);
    const seen = async (a: Actor, table: string) => (await as(a, (t) => sql.raw(`SELECT * FROM ${table}`).execute(t))).rows.length;
    const own = (await as(s1, (t) => sql<{ student_id: string }>`SELECT student_id FROM selections`.execute(t))).rows;
    expect(own.every((r) => r.student_id === s1.studentId)).toBe(true); expect(own.length).toBeGreaterThan(0);
    expect((await as(s2, (t) => sql<{ id: string }>`SELECT id FROM selections WHERE id = ${x.sels[0]}`.execute(t))).rows).toHaveLength(0);
    for (const who of [coord, w.A.coordinator, w.B.officer, w.B.admin, w.B.student]) for (const tbl of ["selections", "selection_events", "placements"]) expect(await seen(who, tbl), `${who.role} ${tbl}`).toBe(0);
    for (const who of [s1, coord]) expect(await seen(who, "selection_events"), who.role).toBe(0);
    expect(await seen(officer(), "selection_events")).toBeGreaterThan(0);
  });
  it("the runtime role cannot write any of these tables; history and files are immutable even to the definer role; illegal transitions are blocked", async () => {
    const { sel, stu } = await accepted();
    for (const q of [sql`UPDATE selections SET offer_status = 'ACCEPTED'`, sql`INSERT INTO selections (college_id, drive_id, registration_id, student_id, selected_by) VALUES (null, null, null, null, null)`, sql`DELETE FROM selections`,
      sql`UPDATE placements SET status = 'VERIFIED'`, sql`DELETE FROM selection_events`, sql`UPDATE selection_files SET kind = 'OFFER_LETTER'`]) {
      for (const who of [officer(), stu, w.A.admin]) expect(await code(as(who, (t) => q.execute(t))), who.role).toBe(DENIED);
    }
    await expect(adminWrite("DELETE FROM selections WHERE id = $1", [sel])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("UPDATE selections SET offer_status = 'NOT_ISSUED' WHERE id = $1", [sel])).rejects.toMatchObject({ code: DENIED });     // ACCEPTED -> NOT_ISSUED
    await expect(adminWrite("UPDATE selections SET offer_status = 'ISSUED' WHERE id = $1", [sel])).rejects.toMatchObject({ code: DENIED });         // ACCEPTED -> ISSUED
    await expect(adminWrite("UPDATE selections SET offered_ctc_lpa = 99 WHERE id = $1", [sel])).rejects.toMatchObject({ code: DENIED });            // terms frozen after the response? (ACCEPTED)
    await expect(adminWrite("UPDATE selection_events SET note = 'x' WHERE selection_id = $1", [sel])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM selection_events WHERE selection_id = $1", [sel])).rejects.toMatchObject({ code: DENIED });
    const f = await mkFile(stu, sel, "JOINING_PROOF");
    await expect(adminWrite("UPDATE selection_files SET original_name = 'x.pdf' WHERE id = $1", [f])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM selection_files WHERE id = $1", [f])).rejects.toMatchObject({ code: DENIED });
    await call(stu, sql`SELECT offers.record_joining(${sel}::uuid, ${new Date().toISOString().slice(0, 10)}::date, null, null, ${f}::uuid)`); await decide(officer(), sel, "VERIFIED");
    await expect(adminWrite("UPDATE placements SET joined_on = '2020-02-02' WHERE selection_id = $1", [sel])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM placements WHERE selection_id = $1", [sel])).rejects.toMatchObject({ code: DENIED });
  });
  it("the staff read models list names, statuses and files for their own college only", async () => {
    const x = await selected(2); await issue(officer(), x.sels[0]);
    const list = (a: Actor | null) => call(a, sql`SELECT * FROM offers.list_for_drive(${x.drive}::uuid)`);
    const rows = (await list(officer())).rows as { full_name: string; offer_status: string }[];
    expect(rows).toHaveLength(2); expect(rows.map((r) => r.offer_status).sort()).toEqual(["ISSUED", "NOT_ISSUED"]); expect(rows[0].full_name).toBeTruthy();
    expect((await list(w.A.admin)).rows).toHaveLength(2);
    for (const who of [null, x.studs[0], coord, w.pa]) expect(await code(list(who)), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(list(w.B.officer))).toBe("22023");
    for (const who of [null, x.studs[0], coord, w.pa]) { expect(await code(call(who, sql`SELECT * FROM offers.list_placements(null)`)), who?.role ?? "anonymous").toBe(DENIED); expect(await code(call(who, sql`SELECT * FROM offers.funnel()`)), who?.role ?? "anonymous").toBe(DENIED); }
    expect(await code(call(officer(), sql`SELECT * FROM offers.list_placements('BOGUS')`))).toBe("22023");
    const ids = (await call(w.B.officer, sql`SELECT selection_id FROM offers.list_placements(null)`)).rows as { selection_id: string }[];
    expect(ids.some((r) => r.selection_id === x.sels[0])).toBe(false);
  });
});

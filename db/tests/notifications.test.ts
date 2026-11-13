import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, DENIED, driveInput, inspect, makeCompany, makeCoordinator, makeDepartment, makeDrive, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
type Stu = Actor & { studentId: string };
let w: World; let co: string; let d1: string; let d2: string; let c1: Actor; let c2: Actor;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const officer = () => w.A.officer;
const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const future = () => new Date(Date.now() + 7 * 86400_000).toISOString();
type N = { id: string; category: string; title: string; body: string | null; link: string | null; read_at: Date | null };
const inbox = async (a: Actor) => (await as(a, (t) => sql<N>`SELECT id, category, title, body, link, read_at FROM notifications ORDER BY created_at, id`.execute(t))).rows;
const titles = async (a: Actor) => (await inbox(a)).map((n) => n.title);
const since = async (a: Actor, before: number) => (await inbox(a)).slice(before);
let n = 0;
const student = async (dept: string, label = "ntf") => makeStudentIn(w.A.admin, dept, `${label}${++n}`) as Promise<Stu>;
const verifiedStudent = async (dept: string): Promise<Stu> => {
  const s = await student(dept);
  const sub = (await call(s, sql`SELECT academics.submit(8, 80, 80, null, 0, 0, null) AS id`)).rows[0] as { id: string };
  await call(dept === d1 ? c1 : c2, sql`SELECT academics.verify(${sub.id}::uuid, null)`);
  return s;
};
const publish = (drive: string) => call(officer(), sql`SELECT placement.publish_drive(${drive}::uuid)`);

beforeAll(async () => {
  w = await seedTwoColleges();
  co = await makeCompany(officer(), "Notify Co"); d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin);
  c1 = await makeCoordinator(w.A.admin, [d1], "ntc1"); c2 = await makeCoordinator(w.A.admin, [d2], "ntc2");
});
afterAll(async () => { await closeAppDb(); });

describe("the inbox is private and tamper-proof", () => {
  it("each user sees only their own notifications; the runtime role cannot create, edit or delete any", async () => {
    const s1 = await student(d1); const s2 = await student(d1);
    const drive = await makeDrive(officer(), driveInput(co, [d1]), true);
    expect((await titles(s1)).some((t) => t.includes("New placement drive"))).toBe(true);
    const mine = await inbox(s1);
    expect(await inbox(s2)).toHaveLength(1);                                                            // s2 got its own copy
    expect((await inbox(s2)).every((x) => !mine.some((m) => m.id === x.id))).toBe(true);
    for (const who of [w.B.student, w.B.officer, w.B.admin, w.pa]) expect((await inbox(who)).some((x) => x.link?.includes(drive)), who.role).toBe(false);
    for (const q of [sql`INSERT INTO notifications (college_id, user_id, category, title) VALUES (${s1.collegeId}, ${s1.userId}, 'DRIVES', 'forged')`, sql`UPDATE notifications SET title = 'x'`, sql`UPDATE notifications SET read_at = now()`, sql`DELETE FROM notifications`,
      sql`INSERT INTO notification_preferences (college_id, user_id, category, enabled) VALUES (${s1.collegeId}, ${s1.userId}, 'DRIVES', false)`]) {
      expect(await code(as(s1, (t) => q.execute(t)))).toBe(DENIED);
    }
    expect(await code(call(null, sql`SELECT notifications.mark_read(${mine[0].id}::uuid)`))).toBe(DENIED);
    expect(await code(call(w.pa, sql`SELECT notifications.mark_all_read()`))).toBe(DENIED);
  });
  it("content is immutable even to the definer role; links must be relative application paths", async () => {
    const s = await student(d1); await makeDrive(officer(), driveInput(co, [d1]), true);
    const [row] = await inspect<{ id: string }>("SELECT id FROM notifications WHERE user_id = $1", [s.userId]);
    await expect(adminWrite("UPDATE notifications SET title = 'changed' WHERE id = $1", [row.id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM notifications WHERE id = $1", [row.id])).rejects.toMatchObject({ code: DENIED });
    for (const link of ["https://evil.example/login", "//evil.example", "javascript:alert(1)", "/ok path", "/<script>"]) {
      await expect(adminWrite("INSERT INTO notifications (college_id, user_id, category, title, link) VALUES ($1, $2, 'DRIVES', 't', $3)", [s.collegeId, s.userId, link]), link).rejects.toMatchObject({ code: "23514" });
    }
    await expect(adminWrite("INSERT INTO notifications (college_id, user_id, category, title) VALUES ($1, $2, 'DRIVES', 't')", [w.B.admin.collegeId, s.userId])).rejects.toMatchObject({ code: "23503" });   // recipient must belong to the college
  });
  it("read state: only the owner can mark read, once; mark-all affects only their own", async () => {
    const s1 = await student(d1); const s2 = await student(d1);
    await makeDrive(officer(), driveInput(co, [d1]), true); await makeDrive(officer(), driveInput(co, [d1]), true);
    const [a, b] = await inbox(s1);
    expect(((await call(s2, sql`SELECT notifications.mark_read(${a.id}::uuid) AS r`)).rows[0] as { r: boolean }).r).toBe(false);          // someone else's
    expect((await inbox(s1))[0].read_at).toBeNull();
    expect(((await call(s1, sql`SELECT notifications.mark_read(${a.id}::uuid) AS r`)).rows[0] as { r: boolean }).r).toBe(true);
    expect(((await call(s1, sql`SELECT notifications.mark_read(${a.id}::uuid) AS r`)).rows[0] as { r: boolean }).r).toBe(false);          // already read
    expect(((await call(s1, sql`SELECT notifications.mark_all_read() AS n`)).rows[0] as { n: number }).n).toBe(1);
    expect((await inbox(s1)).every((x) => x.read_at)).toBe(true); expect((await inbox(s2)).every((x) => !x.read_at)).toBe(true);
    void b;
  });
});

describe("drives and rounds", () => {
  it("publishing notifies exactly the students the identity criteria match — not other departments, other degrees, staff or other colleges — and only the first time", async () => {
    const s1 = await student(d1); const s2 = await student(d2);
    const [o1, o2, b1] = [await inbox(officer()), await inbox(w.A.admin), await inbox(w.B.student)].map((x) => x.length);
    const drive = await makeDrive(officer(), driveInput(co, [d1]), false);
    const before = [(await inbox(s1)).length, (await inbox(s2)).length];
    await publish(drive);
    expect([(await inbox(s1)).length - before[0], (await inbox(s2)).length - before[1]]).toEqual([1, 0]);
    const note = (await since(s1, before[0]))[0];
    expect(note).toMatchObject({ category: "DRIVES", link: `/student/drives/${drive}` });
    expect([(await inbox(officer())).length, (await inbox(w.A.admin)).length, (await inbox(w.B.student)).length]).toEqual([o1, o2, b1]);
    await call(officer(), sql`SELECT placement.set_drive_status(${drive}::uuid, 'DRAFT')`); await publish(drive);          // unpublish and publish again
    expect((await inbox(s1)).length - before[0]).toBe(1);                                                                // no duplicate
    const btech = await makeDrive(officer(), driveInput(co, [d1], { degrees: ["B.Tech"] }), true);                         // students here are B.E.
    expect((await inbox(s1)).some((x) => x.link === `/student/drives/${btech}`)).toBe(false);
  });
  it("round scheduling reaches registered students only; release reaches students who have a result", async () => {
    const drive = await makeDrive(officer(), driveInput(co, [d1, d2]), true);
    const a = await verifiedStudent(d1); const b = await verifiedStudent(d1); const out = await verifiedStudent(d2);
    const regA = ((await call(a, sql`SELECT registrations.register(${drive}::uuid) AS id`)).rows[0] as { id: string }).id;
    await call(b, sql`SELECT registrations.register(${drive}::uuid)`); await call(b, sql`SELECT registrations.withdraw(${drive}::uuid)`);
    const mark = [(await inbox(a)).length, (await inbox(b)).length, (await inbox(out)).length];
    const round = ((await call(officer(), sql`SELECT rounds.save_round(null, ${drive}::uuid, 'Aptitude', 'APTITUDE', null, null, null) AS id`)).rows[0] as { id: string }).id;
    expect([(await inbox(a)).length - mark[0], (await inbox(b)).length - mark[1], (await inbox(out)).length - mark[2]]).toEqual([1, 0, 0]);
    await call(officer(), sql`SELECT placement.set_drive_status(${drive}::uuid, 'CLOSED')`);
    await call(officer(), sql`SELECT rounds.set_results(${round}::uuid, ${sql.raw(`ARRAY['${regA}']::uuid[]`)}, 'REJECTED', null)`);
    const m2 = (await inbox(a)).length;
    expect((await since(a, m2)).length).toBe(0);                                                                         // recording results notifies nobody
    await call(officer(), sql`SELECT rounds.release_round(${round}::uuid)`);
    expect((await since(a, m2)).map((x) => x.title)).toEqual(["Results released: Aptitude"]);
    expect((await inbox(b)).length - mark[1]).toBe(0);
  });
});

describe("offers and placements", () => {
  it("every step reaches the right people: the student for offers and decisions, officers (not other colleges) for responses and joining", async () => {
    const drive = await makeDrive(officer(), driveInput(co, [d1]), true);
    const s = await verifiedStudent(d1);
    const regId = ((await call(s, sql`SELECT registrations.register(${drive}::uuid) AS id`)).rows[0] as { id: string }).id;
    await call(officer(), sql`SELECT placement.set_drive_status(${drive}::uuid, 'CLOSED')`);
    const round = ((await call(officer(), sql`SELECT rounds.save_round(null, ${drive}::uuid, 'Final', 'HR', null, null, null) AS id`)).rows[0] as { id: string }).id;
    await call(officer(), sql`SELECT rounds.set_results(${round}::uuid, ${sql.raw(`ARRAY['${regId}']::uuid[]`)}, 'SELECTED', null)`); await call(officer(), sql`SELECT rounds.release_round(${round}::uuid)`);
    const mark = { s: (await inbox(s)).length, o: (await inbox(officer())).length, a: (await inbox(w.A.admin)).length, bo: (await inbox(w.B.officer)).length };
    await call(officer(), sql`SELECT offers.select_students(${drive}::uuid, ${sql.raw(`ARRAY['${regId}']::uuid[]`)})`);
    const sel = (await inspect<{ id: string }>("SELECT id FROM selections WHERE student_id = $1", [s.studentId]))[0].id;
    await call(officer(), sql`SELECT offers.issue_offer(${sel}::uuid, 7, ${future()}::timestamptz, null)`);
    await call(officer(), sql`SELECT offers.extend_deadline(${sel}::uuid, ${new Date(Date.now() + 9 * 86400_000).toISOString()}::timestamptz)`);
    expect((await since(s, mark.s)).map((x) => [x.category, x.title])).toEqual([["OFFERS", "You have been selected"], ["OFFERS", "You have received an offer"], ["OFFERS", "Offer response deadline extended"]]);
    expect((await since(s, mark.s)).every((x) => x.link === `/student/offers/${sel}`)).toBe(true);
    await call(s, sql`SELECT offers.respond(${sel}::uuid, true)`);
    const file = (await call(s, sql`SELECT offers.register_file(${sel}::uuid, 'JOINING_PROOF', 'p.pdf', 'application/pdf', 100, ${hex().slice(0, 64)}, ${`c/${s.collegeId}/o/${sel}/${randomUUID()}`}) AS id`)).rows[0] as { id: string };
    await call(s, sql`SELECT offers.record_joining(${sel}::uuid, ${new Date().toISOString().slice(0, 10)}::date, null, null, ${file.id}::uuid)`);
    const officerNotes = await since(officer(), mark.o);
    expect(officerNotes.map((x) => [x.category, x.title.replace(/ .*accepted.*/, " accepted")])).toEqual([["TASKS", expect.stringContaining("accepted")], ["TASKS", expect.stringContaining("Joining awaiting verification")]]);
    expect((await inbox(w.A.admin)).length).toBe(mark.a); expect((await inbox(w.B.officer)).length).toBe(mark.bo);   // admins are not task recipients; other colleges never
    const m2 = (await inbox(s)).length;
    await call(officer(), sql`SELECT offers.decide_placement(${sel}::uuid, 'REJECTED', 'Unreadable document')`);
    await call(w.A.admin, sql`SELECT offers.override_placement(${sel}::uuid, 'VERIFIED', 'Verified against the original letter')`);
    expect((await since(s, m2)).map((x) => [x.category, x.title])).toEqual([["PLACEMENT", "Your joining record was not verified"], ["PLACEMENT", "Your placement was verified"]]);
    await expect(call(officer(), sql`SELECT offers.withdraw_offer(${sel}::uuid, 'Company cancelled the role')`)).rejects.toThrow(/verified placement/);
  });
  it("a withdrawn offer notifies the student", async () => {
    const drive = await makeDrive(officer(), driveInput(co, [d1]), true); const s = await verifiedStudent(d1);
    const regId = ((await call(s, sql`SELECT registrations.register(${drive}::uuid) AS id`)).rows[0] as { id: string }).id;
    await call(officer(), sql`SELECT placement.set_drive_status(${drive}::uuid, 'CLOSED')`);
    const round = ((await call(officer(), sql`SELECT rounds.save_round(null, ${drive}::uuid, 'Final', 'HR', null, null, null) AS id`)).rows[0] as { id: string }).id;
    await call(officer(), sql`SELECT rounds.set_results(${round}::uuid, ${sql.raw(`ARRAY['${regId}']::uuid[]`)}, 'SELECTED', null)`); await call(officer(), sql`SELECT rounds.release_round(${round}::uuid)`);
    await call(officer(), sql`SELECT offers.select_students(${drive}::uuid, ${sql.raw(`ARRAY['${regId}']::uuid[]`)})`);
    const sel = (await inspect<{ id: string }>("SELECT id FROM selections WHERE student_id = $1", [s.studentId]))[0].id; const m = (await inbox(s)).length;
    await call(officer(), sql`SELECT offers.withdraw_offer(${sel}::uuid, 'Position was cancelled')`);
    expect((await since(s, m)).map((x) => x.title)).toEqual(["Your offer was withdrawn"]);
  });
});

describe("academics and documents", () => {
  it("a submission notifies the coordinators of that department only; the decision notifies the student", async () => {
    const s = await student(d1); const m = { c1: (await inbox(c1)).length, c2: (await inbox(c2)).length };
    const sub = (await call(s, sql`SELECT academics.submit(8, 80, 80, null, 0, 0, null) AS id`)).rows[0] as { id: string };
    expect([(await inbox(c1)).length - m.c1, (await inbox(c2)).length - m.c2]).toEqual([1, 0]);
    expect((await since(c1, m.c1))[0]).toMatchObject({ category: "TASKS", link: "/coordinator/verification" });
    const ms = (await inbox(s)).length;
    await call(c1, sql`SELECT academics.reject(${sub.id}::uuid, 'Marks do not match the sheet')`);
    expect((await since(s, ms)).map((x) => [x.category, x.title])).toEqual([["ACADEMICS", "Your academic record needs correction"]]);
    const sub2 = (await call(s, sql`SELECT academics.submit(8.5, 80, 80, null, 0, 0, null) AS id`)).rows[0] as { id: string };
    await call(c1, sql`SELECT academics.verify(${sub2.id}::uuid, null)`);
    expect((await since(s, ms)).map((x) => x.title)).toEqual(["Your academic record needs correction", "Your academic record was verified"]);
  });
  it("uploading a mark sheet notifies the coordinator; reviewing it notifies the student; a résumé (no review) notifies nobody", async () => {
    const s = await student(d1); const m = { c: (await inbox(c1)).length, s: (await inbox(s)).length };
    const reg = (kind: string) => call(s, sql`SELECT documents.register(${kind}, 'f.pdf', 'application/pdf', 1000, ${hex().slice(0, 64)}, ${`c/${s.collegeId}/s/${s.studentId}/${randomUUID()}`}) AS id`);
    await reg("RESUME"); expect((await inbox(c1)).length).toBe(m.c);
    const doc = (await reg("MARKSHEET")).rows[0] as { id: string };
    expect((await since(c1, m.c)).map((x) => x.title)).toEqual([expect.stringContaining("Document awaiting review")]);
    await call(c1, sql`SELECT documents.review(${doc.id}::uuid, 'REJECTED', 'The scan is blurry')`);
    expect((await since(s, m.s)).map((x) => [x.category, x.title])).toEqual([["DOCUMENTS", "A document was rejected"]]);
  });
});

describe("preferences and disabled accounts", () => {
  it("opting out of a category stops those notifications; offers and placement cannot be switched off; invalid input is refused", async () => {
    const s = await student(d1);
    expect(await code(call(s, sql`SELECT notifications.set_preference('DRIVES', false)`))).toBe("OK");
    const m = (await inbox(s)).length;
    await makeDrive(officer(), driveInput(co, [d1]), true);
    expect((await inbox(s)).length).toBe(m);                                                                              // muted
    await call(s, sql`SELECT notifications.set_preference('DRIVES', true)`);
    await makeDrive(officer(), driveInput(co, [d1]), true);
    expect((await inbox(s)).length).toBe(m + 1);
    for (const cat of ["OFFERS", "PLACEMENT"]) expect(await code(call(s, sql`SELECT notifications.set_preference(${cat}, false)`)), cat).toBe("22023");
    expect(await code(call(s, sql`SELECT notifications.set_preference('NOPE', true)`))).toBe("22023");
    expect(await code(call(s, sql`SELECT notifications.set_preference(null, true)`))).toBe("22023");
    expect(await code(call(null, sql`SELECT notifications.set_preference('DRIVES', false)`))).toBe(DENIED);
    expect((await as(s, (t) => sql<{ category: string; enabled: boolean }>`SELECT category, enabled FROM notification_preferences`.execute(t))).rows).toEqual([{ category: "DRIVES", enabled: true }]);
    const other = await student(d1); expect((await as(other, (t) => sql`SELECT * FROM notification_preferences`.execute(t))).rows).toHaveLength(0);       // preferences are private too
  });
  it("a disabled account receives nothing", async () => {
    const s = await student(d1);
    await adminWrite("UPDATE users SET status = 'DISABLED' WHERE id = $1", [s.userId]);
    await makeDrive(officer(), driveInput(co, [d1]), true);
    expect((await inspect("SELECT 1 FROM notifications WHERE user_id = $1", [s.userId]))).toHaveLength(0);
  });
});

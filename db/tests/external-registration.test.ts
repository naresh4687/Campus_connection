import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { appDb, closeAppDb, code, DENIED, driveInput, inspect, makeCompany, makeCoordinator, makeDepartment, makeDrive, makeStudentIn, seedTwoColleges, uniq, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let co: string; let d1: string; let d2: string; let c1: Actor; let c2: Actor;
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, appDb());
const run = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(appDb()));
const hex = () => randomBytes(32).toString("hex");
const URL1 = "https://forms.example.test/apply/abc";

async function verified(s: Actor, coord: Actor) {
  const r = (await run(s, sql`SELECT academics.submit(8, 80, 80, null, 0, 0, null) AS id`)).rows[0] as { id: string };
  await run(coord, sql`SELECT academics.verify(${r.id}::uuid, null)`);
}
let n = 0;
const student = async (dept = d1, coord = c1) => { const s = await makeStudentIn(w.A.admin, dept, `ext${++n}`); await verified(s, coord); return s; };
/** An external drive, published, the way an officer does it: draft -> set the method (confirming the link) -> publish. */
async function externalDrive(over: { confirm?: boolean; deadlineDays?: number } = {}) {
  const id = await makeDrive(w.A.officer, driveInput(co, [d1]));
  await run(w.A.officer, sql`SELECT placement.set_drive_registration(${id}::uuid, 'EXTERNAL', ${URL1}, 'Fill in the form, then upload the confirmation page.', ${over.confirm ?? true}, true)`);
  if (over.confirm !== false) await run(w.A.officer, sql`SELECT placement.publish_drive(${id}::uuid)`);
  return id;
}
const keyFor = async (s: Actor) => { const [r] = await inspect<{ id: string }>("SELECT id FROM students WHERE user_id = $1", [s.userId]); return `c/${s.collegeId}/s/${r.id}/${crypto.randomUUID()}`; };
const begin = (s: Actor | null, drive: string) => run(s, sql`SELECT * FROM registrations.begin_external(${drive}::uuid)`);
const submit = async (s: Actor, drive: string, key?: string, type = "image/png") => (await run(s, sql`SELECT registrations.submit_evidence(${drive}::uuid, ${key ?? await keyFor(s)}, 'confirmation.png', ${type}, 2048, ${hex()}) AS id`)).rows[0] as { id: string };
const regOf = async (s: Actor, drive: string) => (await inspect<{ status: string; evidence_status: string; method: string }>("SELECT r.status, r.evidence_status, r.method FROM registrations r JOIN students st ON st.id = r.student_id WHERE r.drive_id = $1 AND st.user_id = $2", [drive, s.userId]))[0];

beforeAll(async () => {
  w = await seedTwoColleges();
  co = await makeCompany(w.A.officer); d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin);
  c1 = await makeCoordinator(w.A.admin, [d1], "xc1"); c2 = await makeCoordinator(w.A.admin, [d2], "xc2");
});
afterAll(async () => { await closeAppDb(); });

describe("configuring the method", () => {
  it("only an officer can set it; an external drive needs a link and cannot be published until the link is confirmed", async () => {
    const id = await makeDrive(w.A.officer, driveInput(co, [d1]));
    expect(await code(run(w.B.officer, sql`SELECT placement.set_drive_registration(${id}::uuid, 'EXTERNAL', ${URL1}, null, true, true)`))).toBe("22023");      // another college's drive does not exist for them
    for (const who of [c1, w.A.student, w.A.admin, null]) expect(await code(run(who, sql`SELECT placement.set_drive_registration(${id}::uuid, 'EXTERNAL', ${URL1}, null, true, true)`))).toBe(DENIED);
    expect(await code(run(w.A.officer, sql`SELECT placement.set_drive_registration(${id}::uuid, 'EXTERNAL', 'not a link', null, true, true)`))).toBe("22023");
    await run(w.A.officer, sql`SELECT placement.set_drive_registration(${id}::uuid, 'EXTERNAL', ${URL1}, null, false, true)`);          // link given but NOT confirmed as the real form
    expect(await code(run(w.A.officer, sql`SELECT placement.publish_drive(${id}::uuid)`))).toBe("22023");
    await run(w.A.officer, sql`SELECT placement.set_drive_registration(${id}::uuid, 'EXTERNAL', ${URL1}, null, true, true)`);
    await run(w.A.officer, sql`SELECT placement.publish_drive(${id}::uuid)`);
  });
  it("an internal drive is untouched: one click registers, and the external door refuses it", async () => {
    const id = await makeDrive(w.A.officer, driveInput(co, [d1]), true);
    const s = await student();
    expect(await code(begin(s, id))).toBe("22023");
    await run(s, sql`SELECT registrations.register(${id}::uuid)`);
    expect(await regOf(s, id)).toMatchObject({ status: "REGISTERED", method: "INTERNAL", evidence_status: null });
  });
  it("the one-click path cannot register for an external drive", async () => {
    const id = await externalDrive(); const s = await student();
    expect(await code(run(s, sql`SELECT registrations.register(${id}::uuid)`))).toBe("22023");
  });
  it("the method and link cannot change once students have started", async () => {
    const id = await externalDrive(); const s = await student(); await begin(s, id);
    expect(await code(run(w.A.officer, sql`SELECT placement.set_drive_registration(${id}::uuid, 'INTERNAL', null, null, false, true)`))).toBe("22023");
    expect(await code(run(w.A.officer, sql`SELECT placement.set_drive_registration(${id}::uuid, 'EXTERNAL', 'https://other.example.test/x', null, true, true)`))).toBe("22023");
  });
});

describe("the student's path", () => {
  it("opening the link only records an intent: PENDING_EXTERNAL, not registered, and the same call twice is the same registration", async () => {
    const id = await externalDrive(); const s = await student();
    const a = (await begin(s, id)).rows[0] as { registration_id: string; external_url: string }; const b = (await begin(s, id)).rows[0] as { registration_id: string };
    expect(a.registration_id).toBe(b.registration_id); expect(a.external_url).toBe(URL1);
    expect(await regOf(s, id)).toMatchObject({ status: "PENDING_EXTERNAL", evidence_status: "NOT_SUBMITTED" });
    expect((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM registrations WHERE drive_id = $1", [id]))[0].n).toBe("1");
    const roster = await run(w.A.officer, sql`SELECT * FROM registrations.list_for_drive(${id}::uuid)`); expect(roster.rows).toHaveLength(0);     // not an applicant yet
  });
  it("a student who is not eligible cannot even start", async () => {
    const id = await makeDrive(w.A.officer, driveInput(co, [d1], { minCgpa: 9.5 })); await run(w.A.officer, sql`SELECT placement.set_drive_registration(${id}::uuid, 'EXTERNAL', ${URL1}, null, true, true)`);
    await run(w.A.officer, sql`SELECT placement.publish_drive(${id}::uuid)`);
    const s = await student(); expect(await code(begin(s, id))).toBe("22023");
    expect((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM registrations WHERE drive_id = $1", [id]))[0].n).toBe("0");
  });
  it("a screenshot makes the registration REGISTERED with the evidence awaiting review; it is never described as verified", async () => {
    const id = await externalDrive(); const s = await student(); await begin(s, id);
    await submit(s, id);
    expect(await regOf(s, id)).toMatchObject({ status: "REGISTERED", evidence_status: "SUBMITTED_PENDING_REVIEW" });
    expect((await run(w.A.officer, sql`SELECT * FROM registrations.list_for_drive(${id}::uuid)`)).rows).toHaveLength(1);
    const notes = await inspect<{ title: string }>("SELECT title FROM notifications WHERE user_id = $1 AND title = 'Screenshot submitted'", [s.userId]); expect(notes).toHaveLength(1);
  });
  it("a screenshot is refused without a started registration, for a key that is not the student's own, or a type that is not an image", async () => {
    const id = await externalDrive(); const s = await student(); const other = await student();
    expect(await code(submit(s, id))).toBe("22023");                                   // never started
    await begin(s, id);
    expect(await code(submit(s, id, await keyFor(other)))).toBe("22023");              // another student's key
    expect(await code(submit(s, id, `c/${w.B.collegeId}/s/${crypto.randomUUID()}/${crypto.randomUUID()}`))).toBe("22023");
    expect(await code(submit(s, id, undefined, "application/pdf"))).toBe("22023");
    expect((await regOf(s, id)).status).toBe("PENDING_EXTERNAL");
  });
  it("a second screenshot is refused while the first awaits review; other students and colleges cannot upload for this registration", async () => {
    const id = await externalDrive(); const s = await student(); await begin(s, id); await submit(s, id);
    expect(await code(submit(s, id))).toBe("22023");
    const other = await student(); expect(await code(submit(other, id))).toBe("22023");
    expect(await code(submit(w.B.student, id))).toBe("22023");
  });
  it("after the deadline a pending registration stays pending; staff can allow a late screenshot, and then it is accepted", async () => {
    const id = await externalDrive(); const s = await student(); await begin(s, id);
    await withOwnerDeadline(id);
    expect(await code(submit(s, id))).toBe("22023");
    expect((await regOf(s, id)).status).toBe("PENDING_EXTERNAL");                       // not silently completed
    const reg = (await inspect<{ id: string }>("SELECT id FROM registrations WHERE drive_id = $1", [id]))[0].id;
    expect(await code(run(c1, sql`SELECT registrations.allow_late_evidence(${reg}::uuid, 24, 'bus strike')`))).toBe("42501");
    await run(w.A.officer, sql`SELECT registrations.allow_late_evidence(${reg}::uuid, 24, 'bus strike')`);
    await submit(s, id); expect((await regOf(s, id)).status).toBe("REGISTERED");
  });
});

describe("review, rejection and replacement", () => {
  it("the department's coordinator or an officer verifies; the history keeps every version; another department's coordinator is refused", async () => {
    const id = await externalDrive(); const s = await student(); await begin(s, id); const ev = await submit(s, id);
    expect(await code(run(c2, sql`SELECT registrations.review_evidence(${ev.id}::uuid, 'VERIFIED', null)`))).toBe("42501");
    expect(await code(run(w.B.officer, sql`SELECT registrations.review_evidence(${ev.id}::uuid, 'VERIFIED', null)`))).toBe("42501");
    expect(await code(run(s, sql`SELECT registrations.review_evidence(${ev.id}::uuid, 'VERIFIED', null)`))).toBe(DENIED);
    await run(c1, sql`SELECT registrations.review_evidence(${ev.id}::uuid, 'VERIFIED', null)`);
    expect(await regOf(s, id)).toMatchObject({ status: "REGISTERED", evidence_status: "VERIFIED" });
    expect(await code(run(w.A.officer, sql`SELECT registrations.review_evidence(${ev.id}::uuid, 'REJECTED', 'changed my mind')`))).toBe("22023");       // already decided
  });
  it("rejection needs a reason, keeps the old file, tells the student, and a replacement creates version 2 (no second registration)", async () => {
    const id = await externalDrive(); const s = await student(); await begin(s, id); const v1 = await submit(s, id);
    expect(await code(run(w.A.officer, sql`SELECT registrations.review_evidence(${v1.id}::uuid, 'REJECTED', '')`))).toBe("22023");
    await run(w.A.officer, sql`SELECT registrations.review_evidence(${v1.id}::uuid, 'REJECTED', 'The page is cropped; show the confirmation text.')`);
    expect(await regOf(s, id)).toMatchObject({ status: "REGISTERED", evidence_status: "REJECTED" });
    expect((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM notifications WHERE user_id = $1 AND title = 'Screenshot not accepted'", [s.userId]))[0].n).toBe("1");
    const v2 = await submit(s, id);
    expect(await regOf(s, id)).toMatchObject({ status: "REGISTERED", evidence_status: "SUBMITTED_PENDING_REVIEW" });
    const rows = await inspect<{ version: number; status: string }>("SELECT version, status FROM registration_evidence WHERE registration_id = (SELECT id FROM registrations WHERE drive_id = $1) ORDER BY version", [id]);
    expect(rows).toEqual([{ version: 1, status: "SUPERSEDED" }, { version: 2, status: "SUBMITTED_PENDING_REVIEW" }]);
    expect((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM registrations WHERE drive_id = $1", [id]))[0].n).toBe("1");
    expect(await code(run(w.A.officer, sql`SELECT registrations.review_evidence(${v1.id}::uuid, 'VERIFIED', null)`))).toBe("22023");                  // an old version cannot be reviewed
    await run(w.A.officer, sql`SELECT registrations.review_evidence(${v2.id}::uuid, 'RESUBMISSION_REQUIRED', 'Please include the date.')`);
    expect((await regOf(s, id)).evidence_status).toBe("RESUBMISSION_REQUIRED");
  });
  it("a screenshot's storage key is handed out only to its student and to staff allowed to review it, and every look is audited", async () => {
    const id = await externalDrive(); const s = await student(); await begin(s, id); const ev = await submit(s, id);
    const key = (who: Actor | null) => run(who, sql`SELECT * FROM registrations.evidence_key(${ev.id}::uuid)`);
    expect((await key(s)).rows).toHaveLength(1); expect((await key(c1)).rows).toHaveLength(1); expect((await key(w.A.officer)).rows).toHaveLength(1);
    for (const who of [c2, w.B.officer, w.B.student, await student(), null]) expect(await code(key(who))).not.toBeNull();
    const looks = await inspect<{ n: string }>("SELECT count(*)::text AS n FROM audit_log WHERE action = 'EXTERNAL_EVIDENCE_VIEWED' AND entity_id = (SELECT registration_id::text FROM registration_evidence WHERE id = $1)", [ev.id]);
    expect(Number(looks[0].n)).toBe(3);
  });
  it("the runtime role cannot read the storage key or change evidence directly; other colleges see nothing", async () => {
    const id = await externalDrive(); const s = await student(); await begin(s, id); await submit(s, id);
    expect(await code(run(s, sql`SELECT storage_key FROM registration_evidence`))).toBe("42501");
    expect(await code(run(w.A.officer, sql`UPDATE registration_evidence SET status = 'VERIFIED'`))).toBe("42501");
    expect((await run(w.B.officer, sql`SELECT id FROM registration_evidence`)).rows).toHaveLength(0);
    expect((await run(w.B.officer, sql`SELECT * FROM registrations.evidence_queue(${id}::uuid)`)).rows).toHaveLength(0);
    const q = (await run(c1, sql`SELECT * FROM registrations.evidence_queue(${id}::uuid)`)).rows as { evidence_status: string }[]; expect(q.length).toBeGreaterThan(0);
    expect((await run(c2, sql`SELECT * FROM registrations.evidence_queue(${id}::uuid)`)).rows).toHaveLength(0);       // not their department
  });
  it("counts are per registration, never per upload", async () => {
    const id = await externalDrive(); const a = await student(); const b = await student();
    await begin(a, id); const e1 = await submit(a, id); await run(w.A.officer, sql`SELECT registrations.review_evidence(${e1.id}::uuid, 'REJECTED', 'blurry screenshot')`); await submit(a, id);
    await begin(b, id);
    const c = (await run(w.A.officer, sql`SELECT * FROM registrations.external_counts(${id}::uuid)`)).rows[0] as Record<string, number>;
    expect(c).toMatchObject({ external_started: 2, screenshots_submitted: 1, pending_review: 1, verified: 0, rejected: 0, action_required: 1 });
  });
  it("a withdrawn student can start again and the old evidence is kept", async () => {
    const id = await externalDrive(); const s = await student(); await begin(s, id); await submit(s, id);
    await run(s, sql`SELECT registrations.withdraw(${id}::uuid)`);
    await begin(s, id); expect((await regOf(s, id)).status).toBe("PENDING_EXTERNAL");
    expect((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM registration_evidence WHERE drive_id = $1", [id]))[0].n).toBe("1");
  });
});

async function withOwnerDeadline(drive: string) {
  const { withOwner } = await import("./helpers");
  // Moving a published drive's deadline into the past is not something the application allows, so the test does it as the table owner.
  await withOwner(async (c) => {
    await c.query("BEGIN");
    try { await c.query("ALTER TABLE drives DISABLE TRIGGER drives_guard"); await c.query("SET LOCAL ROLE cc_auth"); await c.query("UPDATE drives SET application_deadline = now() - interval '1 hour' WHERE id = $1", [drive]); await c.query("RESET ROLE"); await c.query("ALTER TABLE drives ENABLE TRIGGER drives_guard"); await c.query("COMMIT"); }
    catch (e) { await c.query("ROLLBACK"); throw e; }
  });
}
void uniq;

describe("extending a deadline", () => {
  it("only an officer, only on a published drive, only to a later future time with a reason; registration reopens", async () => {
    const id = await externalDrive(); const s = await student();
    await withOwnerDeadline(id);
    expect(await code(begin(s, id))).toBe("22023");                                                       // closed automatically by the passed deadline
    const later = new Date(Date.now() + 5 * 86400_000).toISOString();
    for (const who of [c1, w.A.student, w.A.admin, null]) expect(await code(run(who, sql`SELECT placement.extend_deadline(${id}::uuid, ${later}::timestamptz, 'more time needed')`))).toBe("42501");
    expect(await code(run(w.B.officer, sql`SELECT placement.extend_deadline(${id}::uuid, ${later}::timestamptz, 'more time needed')`))).toBe("22023");
    expect(await code(run(w.A.officer, sql`SELECT placement.extend_deadline(${id}::uuid, ${new Date(Date.now() - 1000).toISOString()}::timestamptz, 'more time needed')`))).toBe("22023");
    expect(await code(run(w.A.officer, sql`SELECT placement.extend_deadline(${id}::uuid, ${later}::timestamptz, 'x')`))).toBe("22023");
    await run(w.A.officer, sql`SELECT placement.extend_deadline(${id}::uuid, ${later}::timestamptz, 'more time needed')`);
    await begin(s, id); expect((await regOf(s, id)).status).toBe("PENDING_EXTERNAL");                 // open again
    expect(await code(run(w.A.officer, sql`UPDATE drives SET job_title = 'Changed' WHERE id = ${id}::uuid`))).toBe("42501");   // the rest of a published drive stays frozen
  });
});

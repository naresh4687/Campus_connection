import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, DENIED, driveInput, inspect, makeCompany, makeCoordinator, makeDepartment, makeDrive, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let d1: string; let d2: string; let coord: Actor; let coord2: Actor; let co: string;
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, appDb());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(appDb()));
const J = (v: unknown) => JSON.stringify(v);
const officer = () => w.A.officer;
const base = (o: Record<string, unknown> = {}) => ({ kind: "GENERAL", title: "Resume submission reminder", summary: "Submit your resume by Friday.", ...o });
const dept = (d: string[], o: Record<string, unknown> = {}) => ({ source: "ALL", departments: d, ...o });
const save = async (a: Actor | null, fields: Record<string, unknown>, audience: unknown = null, id: string | null = null, reason: string | null = null, notify = false) =>
  ((await call(a, sql`SELECT announcements.save(${id}::uuid, ${J(fields)}::jsonb, ${audience === null ? null : J(audience)}::jsonb, ${reason}, ${notify}) AS id`)).rows[0] as { id: string }).id;
const publish = async (a: Actor | null, id: string) => ((await call(a, sql`SELECT announcements.publish(${id}::uuid) AS n`)).rows[0] as { n: number }).n;
const archive = (a: Actor | null, id: string) => call(a, sql`SELECT announcements.archive(${id}::uuid)`);
const notifs = (id: string) => inspect<{ user_id: string; title: string }>("SELECT user_id, title FROM notifications WHERE link = $1 ORDER BY created_at", [`/student/announcements/${id}`]);
const visibleTo = async (a: Actor, id: string) => (await call(a, sql`SELECT id FROM announcements WHERE id = ${id}::uuid`)).rows.length === 1;
let n = 0;
const stu = (d: string) => makeStudentIn(w.A.admin, d, `an${++n}`);

beforeAll(async () => {
  w = await seedTwoColleges();
  d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin);
  coord = await makeCoordinator(w.A.admin, [d1], "an-c1"); coord2 = await makeCoordinator(w.A.admin, [d2], "an-c2");
  co = await makeCompany(officer());
});
afterAll(async () => { await closeAppDb(); });

describe("who may write", () => {
  it("only officers and coordinators; students, administrators, other colleges and anonymous callers are refused", async () => {
    for (const who of [null, w.A.student, w.A.admin, w.pa, w.B.admin]) {
      expect(await code(save(who, base(), dept([d1]))), who?.role ?? "anonymous").toBe(DENIED);
      expect(await code(call(who, sql`SELECT announcements.publish(gen_random_uuid())`)), who?.role ?? "anonymous").toBe(DENIED);
      expect(await code(call(who, sql`SELECT announcements.archive(gen_random_uuid())`)), who?.role ?? "anonymous").toBe(DENIED);
    }
  });
  it("the runtime role cannot write the tables directly", async () => {
    for (const q of ["INSERT INTO announcements (college_id, kind, title, created_by, created_by_role) VALUES (gen_random_uuid(), 'GENERAL', 'abc', gen_random_uuid(), 'COORDINATOR')", "UPDATE announcements SET title = 'x'", "DELETE FROM announcement_recipients"]) {
      expect(await code(as(officer(), (t) => sql.raw(q).execute(t))), q).toBe(DENIED);
    }
    await expect(adminWrite("DELETE FROM announcements")).rejects.toMatchObject({ code: DENIED });     // even the definer role: announcements are retained
  });
});

describe("coordinator scope", () => {
  it("a coordinator addresses only their own departments, on the backend", async () => {
    expect(await code(save(coord, base(), dept([d2])))).toBe(DENIED);                       // another department
    expect(await code(save(coord, base(), dept([d1, d2])))).toBe(DENIED);                    // one of two outside
    expect(await code(save(coord, base(), dept([])))).toBe("22023");                         // must name a department
    expect(await code(save(coord, base(), { source: "NAMED", departments: [d1], students: [(await stu(d2)).studentId], named_confirmed: true }))).toBe(DENIED);
    expect(await save(coord, base(), dept([d1]))).toBeTruthy();
  });
  it("a coordinator cannot edit, publish, archive or even see an officer's announcement, nor another coordinator's", async () => {
    const o = await save(officer(), base(), dept([d1]));
    const c2 = await save(coord2, base(), dept([d2]));
    for (const id of [o, c2]) {
      expect(await code(save(coord, { title: "Hijacked title" }, null, id)), "edit").toBe(DENIED);
      expect(await code(publish(coord, id)), "publish").toBe(DENIED);
      expect(await code(archive(coord, id)), "archive").toBe(DENIED);
      expect(await visibleTo(coord, id)).toBe(false);
    }
    expect(await visibleTo(officer(), c2)).toBe(true);                                       // officers and the administrator can read all
    expect(await visibleTo(w.A.admin, c2)).toBe(true);
    expect(await visibleTo(w.B.officer, c2)).toBe(false);
  });
  it("a coordinator may link only a published drive open to their department; never a draft, never someone else's", async () => {
    const draft = await makeDrive(officer(), driveInput(co, [d1]), false);
    const open1 = await makeDrive(officer(), driveInput(co, [d1]), true);
    const open2 = await makeDrive(officer(), driveInput(co, [d2]), true);
    expect(await code(save(coord, base({ drive_id: draft }), dept([d1])))).toBe(DENIED);
    expect(await code(save(coord, base({ drive_id: open2 }), dept([d1])))).toBe(DENIED);
    expect(await save(coord, base({ drive_id: open1 }), dept([d1]))).toBeTruthy();
    const mine = (await call(coord, sql`SELECT id FROM announcements.linkable_drives()`)).rows.map((r) => (r as { id: string }).id);
    expect(mine).toContain(open1); expect(mine).not.toContain(open2); expect(mine).not.toContain(draft);
    expect(await code(save(officer(), base({ drive_id: draft }), dept([d1])))).toBe(DENIED);   // a draft drive is not linkable by anyone
    expect(await save(officer(), base({ drive_id: open2 }), dept([d2]))).toBeTruthy();
  });
  it("a coordinator whose assignment ended can no longer publish to that department", async () => {
    const c = await makeCoordinator(w.A.admin, [d1], "an-c3");
    const s = await stu(d1);
    const id = await save(c, base(), dept([d1]));
    await call(w.A.admin, sql`SELECT college.unassign_coordinator(${d1}::uuid, ${c.userId}::uuid)`);
    expect(await code(publish(c, id))).toBe(DENIED);
    expect(await notifs(id)).toEqual([]);
    void s;
  });
});

describe("publishing and notifications", () => {
  it("a draft notifies nobody; publishing notifies exactly the addressed students, once; the audience is frozen", async () => {
    const a = await stu(d1); const b = await stu(d1); const other = await stu(d2);
    const id = await save(officer(), base({ priority: "URGENT" }), dept([d1]));
    expect(await notifs(id)).toEqual([]);
    expect(await visibleTo(a, id)).toBe(false);                                              // a draft is invisible to students
    const count = await publish(officer(), id);
    expect(count).toBeGreaterThanOrEqual(2);
    const got = (await notifs(id)).map((x) => x.user_id);
    expect(got).toEqual(expect.arrayContaining([a.userId, b.userId])); expect(got).not.toContain(other.userId);
    expect(new Set(got).size).toBe(got.length);
    expect((await notifs(id))[0].title).toMatch(/^Urgent: /);
    expect(await code(publish(officer(), id))).toBe("22023");                                // publishing twice is refused, no second wave
    expect((await notifs(id)).length).toBe(got.length);
    const late = await stu(d1);                                                              // joined after publishing: not addressed
    expect(await visibleTo(a, id)).toBe(true); expect(await visibleTo(other, id)).toBe(false); expect(await visibleTo(late, id)).toBe(false);
    expect(await visibleTo(w.B.student, id)).toBe(false);
  });
  it("students never see the audience definition, the versions or other students' read state", async () => {
    const a = await stu(d1);
    const named = await save(officer(), base({ kind: "SHORTLIST_UPDATE", title: "Shortlist for the next round" }), { source: "NAMED", departments: [], students: [a.studentId], named_confirmed: true });
    await publish(officer(), named);
    expect(await visibleTo(a, named)).toBe(true);
    expect((await call(a, sql`SELECT 1 FROM announcement_audiences`)).rows).toEqual([]);
    expect((await call(a, sql`SELECT 1 FROM announcement_versions`)).rows).toEqual([]);
    expect((await call(a, sql`SELECT 1 FROM announcement_recipients`)).rows).toHaveLength(1);   // only their own row
  });
  it("a student who opens it is marked seen once; staff see counts", async () => {
    const a = await stu(d2); const b = await stu(d2);
    const id = await save(coord2, base(), dept([d2]));
    await publish(coord2, id);
    expect((await call(a, sql`SELECT announcements.mark_seen(${id}::uuid) AS v`)).rows[0]).toEqual({ v: true });
    expect((await call(a, sql`SELECT announcements.mark_seen(${id}::uuid) AS v`)).rows[0]).toEqual({ v: false });
    const e = (await call(coord2, sql`SELECT recipients, seen FROM announcements.engagement(${id}::uuid)`)).rows[0] as { recipients: number; seen: number };
    expect(e.seen).toBe(1); expect(e.recipients).toBeGreaterThanOrEqual(2);
    expect((await call(coord, sql`SELECT * FROM announcements.engagement(${id}::uuid)`)).rows).toEqual([]);   // another coordinator gets nothing
    void b;
  });
  it("opted-out students still see it in their list but get no notification", async () => {
    const a = await stu(d1);
    await call(a, sql`SELECT notifications.set_preference('ANNOUNCEMENTS', false)`);
    const id = await save(officer(), base({ title: "Opt-out check" }), dept([d1]));
    await publish(officer(), id);
    expect((await notifs(id)).map((x) => x.user_id)).not.toContain(a.userId);
    expect(await visibleTo(a, id)).toBe(true);
  });
  it("publication rules: content, dates, named confirmation, alternate-role audience", async () => {
    const x = await stu(d1);
    const bare = await save(officer(), { kind: "GENERAL", title: "No content yet" }, dept([d1]));
    expect(await code(publish(officer(), bare))).toBe("22023");                              // summary mode and no summary
    const noAud = await save(officer(), base({ title: "No audience yet" }));
    expect(await code(publish(officer(), noAud))).toBe("22023");
    const campus = await save(officer(), base({ kind: "ON_CAMPUS_DRIVE", title: "On campus drive" }), dept([d1]));
    expect(await code(publish(officer(), campus))).toBe("22023");                            // an event needs its date
    const past = await save(officer(), base({ title: "Past expiry", expires_at: "2020-01-01T00:00:00Z" }), dept([d1]));
    expect(await code(publish(officer(), past))).toBe("22023");
    const unconfirmed = await save(officer(), base({ title: "Named, unconfirmed" }), { source: "NAMED", departments: [], students: [x.studentId], named_confirmed: false });
    expect(await code(publish(officer(), unconfirmed))).toBe("22023");
    const consent = { kind: "ALTERNATE_ROLE_CONSENT", title: "Alternate role offer", summary: "Graduate Engineer Trainee. Full-time employment may be considered after the internship; it is not guaranteed." };
    const noDeadline = await save(officer(), consent, { source: "NAMED", departments: [], students: [x.studentId], named_confirmed: true });
    expect(await code(publish(officer(), noDeadline))).toBe("22023");
    const wide = await save(officer(), { ...consent, consent_deadline: "2099-01-01T00:00:00Z" }, dept([d1]));
    expect(await code(publish(officer(), wide))).toBe("22023");                              // not to a whole department
    const ok = await save(officer(), { ...consent, consent_deadline: "2099-01-01T00:00:00Z" }, { source: "NAMED", departments: [], students: [x.studentId], named_confirmed: true });
    expect(await publish(officer(), ok)).toBe(1);
  });
  it("a student's departments and passing years narrow every audience", async () => {
    const aud = { source: "ALL", departments: [d1], years: [2099] };
    expect((await call(officer(), sql`SELECT total FROM announcements.audience_count(${J(aud)}::jsonb)`)).rows[0]).toEqual({ total: 0 });
    expect(await code(call(coord, sql`SELECT * FROM announcements.audience_count(${J({ source: "ALL", departments: [d2] })}::jsonb)`))).toBe(DENIED);
    expect(Number(((await call(officer(), sql`SELECT total FROM announcements.audience_count(${J({ source: "CAREER", career: "UNDECIDED", departments: [d1] })}::jsonb)`)).rows[0] as { total: number }).total)).toBeGreaterThan(0);
  });
});

describe("drive audiences", () => {
  it("registered students of a drive, and only they, are addressed; a coordinator is also limited to their department", async () => {
    const drive = await makeDrive(officer(), driveInput(co, [d1, d2]), true);
    const mk = async (d: string) => {
      const s = await stu(d);
      const sub = (await call(s, sql`SELECT academics.submit(8, 80, 80, null, 0, 0, null) AS id`)).rows[0] as { id: string };
      await call(d === d1 ? coord : coord2, sql`SELECT academics.verify(${sub.id}::uuid, null)`);
      return s;
    };
    const r1 = await mk(d1); const r2 = await mk(d2); const notReg = await mk(d1);
    await call(r1, sql`SELECT registrations.register(${drive}::uuid)`); await call(r2, sql`SELECT registrations.register(${drive}::uuid)`);
    const byOfficer = await save(officer(), base({ kind: "ON_CAMPUS_DRIVE", title: "Prodesk IT on campus", event_date: "2099-11-18", event_time: "9:10 AM", venue: "Placement Auditorium", drive_id: drive }), { source: "DRIVE_REGISTERED", drive });
    await publish(officer(), byOfficer);
    const got = (await notifs(byOfficer)).map((x) => x.user_id);
    expect(got).toEqual(expect.arrayContaining([r1.userId, r2.userId])); expect(got).not.toContain(notReg.userId);
    const byCoord = await save(coord, base({ title: "Reminder for registered students" }), { source: "DRIVE_REGISTERED", drive, departments: [d1] });
    await publish(coord, byCoord);
    const got2 = (await notifs(byCoord)).map((x) => x.user_id);
    expect(got2).toContain(r1.userId); expect(got2).not.toContain(r2.userId);
    // an announcement never alters registrations
    expect((await inspect<{ n: number }>("SELECT count(*)::int AS n FROM registrations WHERE drive_id = $1", [drive]))[0].n).toBe(2);
  });
});

describe("editing a published announcement", () => {
  it("needs a reason, makes a version, may re-notify, and cannot change the audience or type", async () => {
    const a = await stu(d1);
    const id = await save(officer(), base({ kind: "TRAINING_VENUE", title: "Cloud training venue", venue: null,
      batches: [{ name: "Batch 1", venue: "CC1 and CC2" }, { name: "Batch 2", venue: "CC3 and CC4" }] }), dept([d1]));
    await publish(officer(), id);
    const before = (await notifs(id)).length;
    expect(await code(save(officer(), { venue: "CC9" }, null, id))).toBe("22023");           // no reason
    expect(await code(save(officer(), { kind: "GENERAL" }, null, id, "Changing the type is wrong"))).toBe("22023");
    expect(await code(save(officer(), {}, dept([d1, d2]), id, "Widening the audience now"))).toBe("22023");
    await save(officer(), { batches: [{ name: "Batch 1", venue: "CC5 and CC6" }, { name: "Batch 2", venue: "CC3 and CC4" }] }, null, id, "Classroom CC1 is unavailable", false);
    expect((await notifs(id)).length).toBe(before);                                          // not an "important change": nobody re-notified
    await save(officer(), { event_time: "11:00 AM" }, null, id, "Time changed after the first circular", true);
    expect((await notifs(id)).length).toBe(before * 2);
    expect((await notifs(id)).some((x) => x.title.startsWith("Updated: "))).toBe(true);
    const versions = (await inspect<{ version: number; reason: string | null; renotified: boolean; snapshot: { batches: { venue: string }[] } }>("SELECT version, reason, renotified, snapshot FROM announcement_versions WHERE announcement_id = $1 ORDER BY version", [id]));
    expect(versions.map((v) => v.version)).toEqual([1, 2, 3]);
    expect(versions[0].snapshot.batches[0].venue).toBe("CC1 and CC2");                       // the previous content is kept
    expect(versions[1].snapshot.batches[0].venue).toBe("CC5 and CC6");
    expect(versions.map((v) => v.renotified)).toEqual([true, false, true]);
    expect(versions[1].reason).toBe("Classroom CC1 is unavailable");
    expect(await code(adminWrite("UPDATE announcement_versions SET reason = 'x'"))).toBe(DENIED);
    expect(a.userId).toBeTruthy();
  });
  it("batches keep their own venues: unnamed, venue-less and duplicate batches are refused", async () => {
    for (const batches of [[{ name: "", venue: "CC1" }], [{ name: "Batch 1", venue: "" }], [{ name: "Batch 1", venue: "CC1" }, { name: "batch 1", venue: "CC2" }]]) {
      expect(await code(save(officer(), base({ kind: "TRAINING_VENUE", batches }), dept([d1]))), J(batches)).toBe("22023");
    }
    const noVenue = await save(officer(), base({ kind: "TRAINING_VENUE", title: "Training with no venue" }), dept([d1]));
    expect(await code(publish(officer(), noVenue))).toBe("22023");
  });
  it("archiving hides it from students and freezes it", async () => {
    const a = await stu(d1);
    const id = await save(officer(), base({ title: "To be archived" }), dept([d1]));
    await publish(officer(), id);
    expect(await visibleTo(a, id)).toBe(true);
    await archive(officer(), id);
    expect(await visibleTo(a, id)).toBe(false);
    expect(await code(save(officer(), { title: "Edited after archive" }, null, id, "Trying anyway please"))).toBe("22023");
    expect(await code(archive(officer(), id))).toBe("22023");
    const draft = await save(officer(), base({ title: "A draft to archive" }), dept([d1]));
    await archive(officer(), draft);
  });
});

describe("matching register numbers for a named audience", () => {
  it("officers match any student of their college, coordinators only their departments; others get nothing", async () => {
    const a = await stu(d1); const b = await stu(d2);
    const regs = (await inspect<{ register_number: string }>("SELECT register_number::text FROM students WHERE id = ANY($1)", [[a.studentId, b.studentId]])).map((r) => r.register_number);
    const m = async (who: Actor | null, nums: string[]) => (await call(who, sql`SELECT student_id FROM announcements.match_students(${sql.raw(`ARRAY[${nums.map((x) => `'${x}'`).join(",")}]::text[]`)})`)).rows.length;
    expect(await m(officer(), [...regs, "NO-SUCH-NUMBER"])).toBe(2);
    expect(await m(officer(), regs.map((r) => ` ${r.toLowerCase()} `))).toBe(2);        // case and spaces do not matter
    expect(await m(coord, regs)).toBe(1);
    expect(await m(w.B.officer, regs)).toBe(0);                                          // another college
    for (const who of [null, w.A.student, w.A.admin]) expect(await code(m(who, regs)), who?.role ?? "anonymous").toBe(DENIED);
  });
});

describe("what the reader found (0031)", () => {
  it("only the draft's author or an officer can store it; students and other colleges see nothing; a published announcement cannot be re-read", async () => {
    const { sql: k } = await import("kysely");
    const id = (await as(w.A.officer, (t) => k<{ id: string }>`SELECT announcements.save(null::uuid, '{"kind":"GENERAL","title":"Reader test","original_message":"hello there everyone"}'::jsonb, null::jsonb, null, false) AS id`.execute(t))).rows[0].id;
    const x = JSON.stringify({ title: { value: "Reader test", status: "EXTRACTED", evidence: "hello" }, warnings: [] });
    await as(w.A.officer, (t) => k`SELECT announcements.save_extraction(${id}::uuid, ${x}::jsonb, 'patterns', 'ann-1')`.execute(t));
    expect((await as(w.A.officer, (t) => k`SELECT 1 FROM announcement_extractions WHERE announcement_id = ${id}::uuid`.execute(t))).rows).toHaveLength(1);
    for (const who of [w.A.student, w.B.officer]) expect((await as(who, (t) => k`SELECT 1 FROM announcement_extractions`.execute(t))).rows).toHaveLength(0);
    for (const who of [w.A.student, w.A.admin]) expect(await code(as(who, (t) => k`SELECT announcements.save_extraction(${id}::uuid, ${x}::jsonb, 'patterns', 'ann-1')`.execute(t)))).toBe("42501");
    expect(await code(as(w.B.officer, (t) => k`SELECT announcements.save_extraction(${id}::uuid, ${x}::jsonb, 'patterns', 'ann-1')`.execute(t)))).toBe("22023");
    expect(await code(as(w.A.officer, (t) => k`SELECT announcements.save_extraction(${id}::uuid, '[]'::jsonb, 'patterns', 'ann-1')`.execute(t)))).toBe("22023");
    expect(await code(as(w.A.officer, (t) => k`UPDATE announcement_extractions SET method = 'x'`.execute(t)))).toBe("42501");
  });
});

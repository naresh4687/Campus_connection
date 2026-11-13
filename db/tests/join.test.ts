import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, createUser, DENIED, FAKE_HASH, inspect, makeCoordinator, makeDepartment, seedTwoColleges, uniq, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let d1: string; let d2: string; let dB: string; let coord1: Actor; let coord2: Actor;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const version = async (c: string) => (await inspect<{ version: number }>("SELECT version FROM college_join_links WHERE college_id = $1", [c]))[0]?.version;
const setLink = (a: Actor | null, enabled: boolean, rotate = false) => call(a, sql`SELECT students.set_join_link(${enabled}, ${rotate})`);
const peek = async (college: string, v: number) => (await call(null, sql`SELECT * FROM students.peek_join(${college}::uuid, ${v}::int)`)).rows as { college_name: string; departments: { id: string; code: string }[] }[];
let n = 0;
type Req = { college?: string; version?: number; dept?: string; register?: string; name?: string; email?: string; personal?: string | null; phone?: string; degree?: string; adm?: number; pass?: number; hash?: string };
const submit = (o: Req = {}) => {
  const i = ++n;
  return call(null, sql`SELECT students.submit_join_request(${o.college ?? w.A.collegeId}::uuid, ${o.version ?? 1}::int, ${o.dept ?? d1}::uuid, ${o.register ?? `JR${1000 + i}${Date.now() % 1000}`}, ${o.name ?? "Join Person"}, ${o.email ?? `join${i}-${uniq("e")}@college.test`},
    ${o.personal ?? null}::citext, ${o.phone ?? "+91 98765 43210"}, ${o.degree ?? "B.E."}, ${o.adm ?? 2022}::int, ${o.pass ?? 2026}::int, ${o.hash ?? FAKE_HASH}, 'iphash') AS id`);
};
const idOf = async (r: ReturnType<typeof submit>) => ((await r).rows[0] as { id: string }).id;
const decide = (a: Actor | null, id: string, approve: boolean, reason: string | null = null) => call(a, sql`SELECT students.decide_join_request(${id}::uuid, ${approve}, ${reason})`);
const statusOf = async (id: string) => (await inspect<{ status: string; password_hash: string | null }>("SELECT status, password_hash FROM join_requests WHERE id = $1", [id]))[0];

beforeAll(async () => {
  w = await seedTwoColleges();
  d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin); dB = await makeDepartment(w.B.admin);
  coord1 = await makeCoordinator(w.A.admin, [d1], "jc1"); coord2 = await makeCoordinator(w.A.admin, [d2], "jc2");
  await setLink(w.A.admin, true);
});
afterAll(async () => { await closeAppDb(); });

describe("the college's sign-up link switch", () => {
  it("only the college administrator can read or change it; rotating kills the old version; disabling blocks everything", async () => {
    for (const who of [null, w.A.officer, coord1, w.A.student, w.pa]) {
      expect(await code(setLink(who, true)), who?.role ?? "anonymous").toBe(DENIED);
      expect(await code(call(who, sql`SELECT * FROM students.join_link_state()`)), who?.role ?? "anonymous").toBe(DENIED);
    }
    expect(await version(w.A.collegeId!)).toBe(1);
    expect((await peek(w.A.collegeId!, 1))).toHaveLength(1);
    await setLink(w.A.admin, true, true);
    expect(await version(w.A.collegeId!)).toBe(2);
    expect(await peek(w.A.collegeId!, 1)).toHaveLength(0);                        // the old link is dead
    expect(await code(submit({ version: 1 }))).toBe("22023");
    expect(await peek(w.A.collegeId!, 2)).toHaveLength(1);
    await setLink(w.A.admin, false);
    expect(await peek(w.A.collegeId!, 2)).toHaveLength(0);
    expect(await code(submit({ version: 2 }))).toBe("22023");
    await setLink(w.A.admin, true);                                               // re-enable (same version)
    expect(await peek(w.A.collegeId!, 2)).toHaveLength(1);
    expect(await peek(w.B.collegeId!, 1)).toHaveLength(0);                        // another college never enabled its link
    expect(await peek(w.A.collegeId!, 1)).toHaveLength(0);
    const audit = await inspect<{ action: string }>("SELECT action FROM audit_log WHERE college_id = $1 AND action LIKE 'JOIN_LINK%' ORDER BY id", [w.A.collegeId]);
    expect(audit.map((a) => a.action)).toEqual(["JOIN_LINK_ENABLED", "JOIN_LINK_ROTATED", "JOIN_LINK_DISABLED", "JOIN_LINK_ENABLED"]);
  });
  it("the page shows only departments this college created and has active", async () => {
    const dInactive = await makeDepartment(w.A.admin);
    await call(w.A.admin, sql`SELECT college.set_department_status(${dInactive}::uuid, 'INACTIVE')`);
    const [p] = await peek(w.A.collegeId!, 2);
    const ids = p.departments.map((d) => d.id);
    expect(ids).toEqual(expect.arrayContaining([d1, d2])); expect(ids).not.toContain(dInactive); expect(ids).not.toContain(dB);
    expect(p.college_name).toBeTruthy();
  });
});

describe("a request creates nothing usable", () => {
  it("anyone with the link can ask; nothing becomes a student or a user until a person approves; the hash is stored", async () => {
    const email = `ask-${uniq("e")}@college.test`;
    const id = await idOf(submit({ version: 2, email }));
    expect(await inspect("SELECT 1 FROM students WHERE college_email = $1", [email])).toHaveLength(0);
    expect(await inspect("SELECT 1 FROM users WHERE email = $1", [email])).toHaveLength(0);
    expect((await statusOf(id)).status).toBe("PENDING"); expect((await statusOf(id)).password_hash).toMatch(/^\$argon2id\$/);
  });
  it("is refused for: a wrong department/college, another college's department, an inactive department, a non-argon2 password, invalid fields, and duplicates", async () => {
    const dInactive = await makeDepartment(w.A.admin); await call(w.A.admin, sql`SELECT college.set_department_status(${dInactive}::uuid, 'INACTIVE')`);
    expect(await code(submit({ version: 2, dept: dB }))).toBe("22023");
    expect(await code(submit({ version: 2, dept: dInactive }))).toBe("22023");
    expect(await code(submit({ version: 2, hash: "plain-text-password" }))).toBe("22023");
    for (const bad of [{ register: "x" }, { email: "not-an-email" }, { phone: "abc" }, { degree: "PhD-ish" }, { adm: 2026, pass: 2025 }, { name: "x" }]) expect(await code(submit({ version: 2, ...bad })), JSON.stringify(bad)).toBe("22023");
    const reg = `DUP${Date.now() % 100000}`; const email = `dup-${uniq("e")}@college.test`;
    await submit({ version: 2, register: reg, email });
    expect(await code(submit({ version: 2, register: reg }))).toBe("23505");                      // same register number pending
    expect(await code(submit({ version: 2, email }))).toBe("23505");                              // same email pending
    expect(await code(submit({ version: 2, email: w.A.student.email }))).toBe("23505");           // an existing user
    expect(await code(submit({ version: 2, email: w.A.officer.email }))).toBe("23505");         // a staff account's email (a user without a student record)
    const existing = (await inspect<{ register_number: string }>("SELECT register_number::text AS register_number FROM students WHERE college_id = $1 LIMIT 1", [w.A.collegeId]))[0].register_number;
    expect(await code(submit({ version: 2, register: existing }))).toBe("23505");                 // an existing student
  });
  it("the runtime role can neither write requests nor read passwords or network hashes; strangers see nothing", async () => {
    const id = await idOf(submit({ version: 2 }));
    for (const who of [w.A.admin, coord1, w.A.student]) {
      expect(await code(as(who, (t) => sql`SELECT password_hash FROM join_requests`.execute(t))), who.role).toBe(DENIED);
      expect(await code(as(who, (t) => sql`SELECT ip_hash FROM join_requests`.execute(t))), who.role).toBe(DENIED);
      expect(await code(as(who, (t) => sql`UPDATE join_requests SET status = 'APPROVED'`.execute(t))), who.role).toBe(DENIED);
      expect(await code(as(who, (t) => sql`DELETE FROM join_requests`.execute(t))), who.role).toBe(DENIED);
    }
    const seen = async (a: Actor) => (await as(a, (t) => sql<{ id: string }>`SELECT id FROM join_requests`.execute(t))).rows.map((r) => r.id);
    expect(await seen(w.A.admin)).toContain(id);
    for (const who of [w.A.officer, w.A.student, w.B.admin, w.B.officer, w.pa]) expect(await seen(who), who.role).toEqual([]);
    await expect(adminWrite("DELETE FROM join_requests WHERE id = $1", [id])).rejects.toMatchObject({ code: DENIED });
  });
  it("coordinators see only requests for their own departments", async () => {
    const a = await idOf(submit({ version: 2, dept: d1 })); const b = await idOf(submit({ version: 2, dept: d2 }));
    const seen = async (x: Actor) => (await as(x, (t) => sql<{ id: string }>`SELECT id FROM join_requests`.execute(t))).rows.map((r) => r.id);
    expect(await seen(coord1)).toContain(a); expect(await seen(coord1)).not.toContain(b);
    expect(await seen(coord2)).toContain(b); expect(await seen(coord2)).not.toContain(a);
  });
});

describe("approval", () => {
  it("only the college administrator or the coordinator of that department decides; another department's request looks missing", async () => {
    const id = await idOf(submit({ version: 2, dept: d1 }));
    for (const who of [null, w.A.officer, w.A.student, w.pa]) expect(await code(decide(who, id, true)), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(decide(coord2, id, true))).toBe("22023");
    expect(await code(decide(w.B.admin, id, true))).toBe("22023");
    expect((await statusOf(id)).status).toBe("PENDING");
    expect(await code(decide(coord1, id, true))).toBe("OK");
  });
  it("approving creates the student record and an ACTIVE account the student can sign in with; the password hash is then erased", async () => {
    const email = `ok-${uniq("e")}@college.test`; const reg = `OK${Date.now() % 100000}`;
    const id = await idOf(submit({ version: 2, dept: d2, email, register: reg, name: "Approved Student", personal: "me@mail.test", phone: "+91 90000 00000" }));
    expect(await code(decide(w.A.admin, id, true))).toBe("OK");
    const [st] = await inspect<{ user_id: string; department_id: string; full_name: string; phone: string; personal_email: string }>("SELECT user_id, department_id, full_name, phone, personal_email::text AS personal_email FROM students WHERE college_email = $1", [email]);
    expect(st).toMatchObject({ department_id: d2, full_name: "Approved Student", phone: "+91 90000 00000", personal_email: "me@mail.test" }); expect(st.user_id).toBeTruthy();
    const login = (await call(null, sql`SELECT * FROM auth.get_login_user(${email}::citext)`)).rows[0] as { id: string; status: string; role: string; college_active: boolean; password_hash: string };
    expect(login).toMatchObject({ id: st.user_id, status: "ACTIVE", role: "STUDENT", college_active: true });
    expect(login.password_hash).toBe(FAKE_HASH);                                             // the hash the student chose, unchanged
    expect(await statusOf(id)).toEqual({ status: "APPROVED", password_hash: null });
    const me = { userId: st.user_id, collegeId: w.A.collegeId!, role: "STUDENT" as const, email };
    expect((await as(me, (t) => sql<{ id: string }>`SELECT id FROM students`.execute(t))).rows).toHaveLength(1);       // the new student sees exactly their own record
    expect(await code(decide(w.A.admin, id, false, "changed my mind"))).toBe("22023");        // decided once
    await expect(adminWrite("UPDATE join_requests SET status = 'PENDING' WHERE id = $1", [id])).rejects.toMatchObject({ code: DENIED });
  });
  it("rejecting needs a reason, creates no account, and erases the stored password hash", async () => {
    const email = `no-${uniq("e")}@college.test`; const id = await idOf(submit({ version: 2, email }));
    expect(await code(decide(w.A.admin, id, false, "no"))).toBe("22023");
    expect(await code(decide(w.A.admin, id, false))).toBe("22023");
    expect(await code(decide(w.A.admin, id, false, "Not a student of this college"))).toBe("OK");
    expect(await statusOf(id)).toEqual({ status: "REJECTED", password_hash: null });
    expect(await inspect("SELECT 1 FROM users WHERE email = $1", [email])).toHaveLength(0);
    expect(await code(submit({ version: 2, email }))).toBe("OK");                            // a rejected person may ask again
  });
  it("cannot be approved if the department was deactivated meanwhile, or if the email/register number was taken in the meantime", async () => {
    const dTmp = await makeDepartment(w.A.admin); const id = await idOf(submit({ version: 2, dept: dTmp }));
    await call(w.A.admin, sql`SELECT college.set_department_status(${dTmp}::uuid, 'INACTIVE')`);
    expect(await code(decide(w.A.admin, id, true))).toBe("22023");
    const email = `race-${uniq("e")}@college.test`; const id2 = await idOf(submit({ version: 2, email }));
    await createUser(w.A.admin, "STUDENT", w.A.collegeId!, "taken", FAKE_HASH, email);        // the same email gets an account some other way
    expect(await code(decide(w.A.admin, id2, true))).toBe("22023");
    expect((await statusOf(id2)).status).toBe("PENDING");
  });
  it("two simultaneous approvals produce exactly one student and one user", async () => {
    const email = `par-${uniq("e")}@college.test`; const id = await idOf(submit({ version: 2, email }));
    const outcomes = await Promise.all([decide(w.A.admin, id, true), decide(coord1, id, true), decide(w.A.admin, id, true)].map((p) => code(p)));
    expect(outcomes.filter((o) => o === "OK")).toHaveLength(1);
    expect(await inspect("SELECT 1 FROM students WHERE college_email = $1", [email])).toHaveLength(1);
    expect(await inspect("SELECT 1 FROM users WHERE email = $1", [email])).toHaveLength(1);
  });
  it("coordinators of the department and the administrators are notified of a new request; nobody else", async () => {
    const count = async (a: Actor) => (await as(a, (t) => sql<{ title: string }>`SELECT title FROM notifications WHERE title LIKE 'Student sign-up awaiting%'`.execute(t))).rows.length;
    const before = [await count(coord1), await count(coord2), await count(w.A.admin), await count(w.A.officer)];
    await submit({ version: 2, dept: d1 });
    expect([await count(coord1) - before[0], await count(coord2) - before[1], await count(w.A.admin) - before[2], await count(w.A.officer) - before[3]]).toEqual([1, 0, 1, 0]);
  });
  it("the pending cap stops a flood of requests", async () => {
    await adminWrite(`INSERT INTO join_requests (college_id, department_id, register_number, full_name, college_email, phone, degree, admission_year, passing_year, password_hash)
      SELECT $1, $2, 'FLOOD' || g, 'Flood Person', 'flood' || g || '@x.test', '9999999999', 'B.E.', 2022, 2026, $3 FROM generate_series(1, 300) g`, [w.A.collegeId, d1, FAKE_HASH]);
    expect(await code(submit({ version: 2 }))).toBe("22023");
  });
});

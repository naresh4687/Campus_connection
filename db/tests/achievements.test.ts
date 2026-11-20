import { randomUUID as randomUuid } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, DENIED, inspect, makeCoordinator, makeDepartment, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World;
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, appDb());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(appDb()));

const add = (a: Actor | null, o: Partial<{ kind: string; title: string; date: string; description: string | null; link: string | null }> = {}) => {
  const v = { kind: "CERTIFICATION", title: `Cert ${Math.random().toString(36).slice(2)}`, date: "2025-06-01", description: null, link: null, ...o };
  return call(a, sql`SELECT achievements.add(${v.kind}, ${v.title}, ${v.date}::date, ${v.description}, ${v.link}) AS id`);
};
const addId = async (a: Actor, o = {}) => ((await add(a, o)).rows[0] as { id: string }).id;
const verify = (a: Actor | null, id: string, note: string | null = null) => call(a, sql`SELECT achievements.verify(${id}::uuid, ${note})`);
const reject = (a: Actor | null, id: string, reason: string | null = "No proof of this was provided") => call(a, sql`SELECT achievements.reject(${id}::uuid, ${reason})`);
const withdraw = (a: Actor | null, id: string) => call(a, sql`SELECT achievements.withdraw(${id}::uuid)`);
const statusOf = async (id: string) => (await inspect<{ status: string }>("SELECT status FROM student_achievements WHERE id = $1", [id]))[0].status;
const seen = async (who: Actor, id: string) => (await as(who, (t) => sql`SELECT 1 FROM student_achievements WHERE id = ${id}::uuid`.execute(t))).rows.length;

let d1: string; let d2: string;
let s1: Actor & { studentId: string }; let s2: Actor & { studentId: string }; let sOther: Actor & { studentId: string };
let c1: Actor; let c2: Actor;

beforeAll(async () => {
  w = await seedTwoColleges();
  d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin);
  s1 = await makeStudentIn(w.A.admin, d1, "ach1"); s2 = await makeStudentIn(w.A.admin, d1, "ach2"); sOther = await makeStudentIn(w.A.admin, d2, "ach3");
  c1 = await makeCoordinator(w.A.admin, [d1], "ach-c1"); c2 = await makeCoordinator(w.A.admin, [d2], "ach-c2");
});
afterAll(async () => { await closeAppDb(); });

describe("who may use the achievement functions", () => {
  it("add/withdraw are for students; verify/reject for coordinators; everyone else is refused", async () => {
    const id = await addId(s2);
    for (const who of [null, w.A.admin, w.A.officer, w.A.coordinator, c1, w.pa]) {
      expect(await code(add(who)), `add as ${who?.role ?? "anonymous"}`).toBe(DENIED);
      expect(await code(withdraw(who, id)), `withdraw as ${who?.role ?? "anonymous"}`).toBe(DENIED);
    }
    for (const who of [null, w.A.admin, w.A.officer, s2, w.pa]) {
      expect(await code(verify(who, id)), `verify as ${who?.role ?? "anonymous"}`).toBe(DENIED);
      expect(await code(reject(who, id)), `reject as ${who?.role ?? "anonymous"}`).toBe(DENIED);
    }
    expect(await statusOf(id)).toBe("SUBMITTED");
  });
  it("a coordinator of another department, or another college's coordinator, cannot decide it", async () => {
    const id = await addId(s1);
    for (const who of [c2, w.B.coordinator]) { expect(await code(verify(who, id))).not.toBe("OK"); expect(await code(reject(who, id))).not.toBe("OK"); }
    expect(await statusOf(id)).toBe("SUBMITTED");
  });
  it("a student cannot withdraw someone else's entry", async () => {
    const id = await addId(s1);
    expect(await code(withdraw(s2, id))).toBe("22023");
    expect(await statusOf(id)).toBe("SUBMITTED");
  });
});

describe("adding", () => {
  it("validates every field and writes nothing when invalid", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "ach-v");
    const tomorrow = new Date(Date.now() + 2 * 86400_000).toISOString().slice(0, 10);
    for (const bad of [{ kind: "NOPE" }, { title: "ab" }, { title: "x".repeat(151) }, { date: tomorrow }, { date: "1999-12-31" }, { description: "x".repeat(601) },
                       { link: "javascript:alert(1)" }, { link: "ftp://x.example" }, { link: "https://a b.example" }, { link: "https://x.example/" + "a".repeat(260) }]) {
      expect(await code(add(st, bad)), JSON.stringify(bad)).toBe("22023");
    }
    expect(await inspect("SELECT 1 FROM student_achievements WHERE student_id = $1", [st.studentId])).toEqual([]);
    expect(await code(add(st, { link: "https://example.org/cert/1", description: "Ok" }))).toBe("OK");
  });
  it("refuses an exact duplicate, allows it again after a rejection, and caps entries awaiting review at 10", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "ach-d");
    const first = await addId(st, { title: "Same Thing" });
    expect(await code(add(st, { title: "  same thing " }))).toBe("23505");
    await reject(c1, first);
    expect(await code(add(st, { title: "Same Thing" }))).toBe("OK");
    for (let i = 0; i < 9; i++) await addId(st);
    expect(await code(add(st))).toBe("23505");
  });
});

describe("review", () => {
  it("verify and reject record reviewer and time; rejection needs a reason; decided entries are frozen", async () => {
    const a = await addId(s1); const b = await addId(s1);
    expect(await code(reject(c1, a, "no"))).toBe("22023");
    expect(await code(reject(c1, a, null))).toBe("22023");
    expect(await code(verify(c1, a, "x".repeat(501)))).toBe("22023");
    expect(await code(verify(c1, a, "Seen the certificate"))).toBe("OK");
    expect(await code(reject(c1, b))).toBe("OK");
    const [va] = await inspect<{ status: string; reviewed_by: string; review_note: string }>("SELECT status, reviewed_by, review_note FROM student_achievements WHERE id = $1", [a]);
    expect(va).toMatchObject({ status: "VERIFIED", reviewed_by: c1.userId, review_note: "Seen the certificate" });
    for (const id of [a, b]) {
      expect(await code(verify(c1, id))).toBe("22023");
      expect(await code(reject(c1, id))).toBe("22023");
      expect(await code(withdraw(s1, id))).toBe("22023");
    }
  });
  it("withdrawing closes an entry so it can no longer be decided", async () => {
    const id = await addId(s2);
    expect(await code(withdraw(s2, id))).toBe("OK");
    expect(await statusOf(id)).toBe("WITHDRAWN");
    expect(await code(verify(c1, id))).toBe("22023");
  });
  it("a coordinator whose assignment ended loses the authority at once", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "ach-r"); const co = await makeCoordinator(w.A.admin, [d1], "ach-rc");
    const id = await addId(st);
    await as(w.A.admin, (t) => sql`SELECT college.unassign_coordinator(${d1}::uuid, ${co.userId}::uuid)`.execute(t));
    expect(await code(verify(co, id))).toBe(DENIED);
    expect(await statusOf(id)).toBe("SUBMITTED");
  });
});

describe("integrity and visibility", () => {
  it("details are immutable, statuses move only along allowed paths, rows are never deleted (even by the owner role)", async () => {
    const id = await addId(s1);
    for (const q of ["UPDATE student_achievements SET title = 'Edited' WHERE id = $1", "UPDATE student_achievements SET achieved_on = '2024-01-01' WHERE id = $1", "UPDATE student_achievements SET link = 'https://x.example' WHERE id = $1", "DELETE FROM student_achievements WHERE id = $1"]) {
      expect(await code(adminWrite(q, [id])), q).toBe(DENIED);
    }
    await verify(c1, id);
    expect(await code(adminWrite("UPDATE student_achievements SET status = 'SUBMITTED', reviewed_by = NULL, reviewed_at = NULL WHERE id = $1", [id]))).toBe(DENIED);
    expect(await code(adminWrite("UPDATE student_achievements SET review_note = 'changed' WHERE id = $1", [id]))).toBe(DENIED);
  });
  it("the runtime role cannot write the table directly", async () => {
    const id = await addId(s1);
    for (const who of [s1, c1, w.A.admin]) {
      expect(await code(call(who, sql`UPDATE student_achievements SET status = 'VERIFIED' WHERE id = ${id}::uuid`))).toBe(DENIED);
      expect(await code(call(who, sql`DELETE FROM student_achievements WHERE id = ${id}::uuid`))).toBe(DENIED);
      expect(await code(call(who, sql`INSERT INTO student_achievements (college_id, student_id, kind, title, achieved_on, submitted_by) VALUES (${s1.collegeId}::uuid, ${s1.studentId}::uuid, 'OTHER', 'forged', '2025-01-01', ${s1.userId}::uuid)`))).toBe(DENIED);
    }
  });
  it("is visible to the student, their department's coordinator and the college admin only", async () => {
    const id = await addId(s1);
    for (const who of [s1, c1, w.A.admin]) expect(await seen(who, id), who.role).toBe(1);
    for (const who of [s2, sOther, c2, w.A.officer, w.B.admin, w.B.coordinator, w.pa]) expect(await seen(who, id), who.role).toBe(0);
  });
  it("is audited and notifies: coordinators on add, the student on a decision", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "ach-n");
    const a = await addId(st); const b = await addId(st);
    await verify(c1, a); await reject(c1, b);
    const log = await inspect<{ actor_role: string; action: string }>("SELECT actor_role, action FROM audit_log WHERE entity_type = 'achievement' AND entity_id = ANY($1) ORDER BY id", [[a, b]]);
    expect(log.map((l) => `${l.actor_role}:${l.action}`)).toEqual(["STUDENT:ACHIEVEMENT_ADDED", "STUDENT:ACHIEVEMENT_ADDED", "COORDINATOR:ACHIEVEMENT_VERIFIED", "COORDINATOR:ACHIEVEMENT_REJECTED"]);
    const mine = (await as(st, (t) => sql<{ title: string }>`SELECT title FROM notifications ORDER BY created_at, id`.execute(t))).rows.map((r) => r.title);
    expect(mine).toEqual(expect.arrayContaining(["An achievement was verified", "An achievement was returned"]));
    const coord = (await as(c1, (t) => sql<{ title: string }>`SELECT title FROM notifications WHERE title LIKE 'Achievement awaiting review%'`.execute(t))).rows.length;
    expect(coord).toBeGreaterThan(0);
    expect(await as(c2, (t) => sql`SELECT 1 FROM notifications WHERE title LIKE 'Achievement awaiting review%'`.execute(t)).then((r) => r.rows.length)).toBe(0);
  });
});

describe("revising a verified achievement (migration 0026)", () => {
  const revise = (a: Actor | null, id: string, o: Partial<{ kind: string; title: string; date: string; description: string | null; link: string | null }> = {}) => {
    const v = { kind: "CERTIFICATION", title: "Revised title", date: "2025-06-01", description: null, link: null, ...o };
    return call(a, sql`SELECT achievements.revise(${id}::uuid, ${v.kind}, ${v.title}, ${v.date}::date, ${v.description}, ${v.link}) AS id`);
  };
  const verified = async (st: Actor, o = {}) => { const id = await addId(st, { title: `Orig ${Math.random().toString(36).slice(2)}`, ...o }); await verify(c1, id); return id; };

  it("only the student's own VERIFIED entry can be revised, and only by the student", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "rv1"); const other = await makeStudentIn(w.A.admin, d1, "rv2");
    const pending = await addId(st); const ok = await verified(st);
    for (const who of [null, c1, w.A.admin, w.A.officer, w.pa]) expect(await code(revise(who, ok)), who?.role ?? "anonymous").toBe(DENIED);
    expect(await code(revise(st, pending))).toBe("22023");                 // not verified yet
    expect(await code(revise(other, ok))).toBe("22023");                   // someone else's entry
    expect(await code(revise(st, randomUuid()))).toBe("22023");
    expect(await code(revise(st, ok))).toBe("OK");
  });

  it("requires a real change, validates the new values, and allows one open revision per entry", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "rv3");
    const id = await verified(st, { title: "Same Title" });
    expect(await code(revise(st, id, { title: "  Same Title " }))).toBe("22023");        // nothing changed
    for (const bad of [{ title: "ab" }, { date: "2999-01-01" }, { link: "javascript:alert(1)" }, { kind: "NOPE" }]) expect(await code(revise(st, id, { title: "Another", ...bad })), JSON.stringify(bad)).toBe("22023");
    const r1 = ((await revise(st, id, { title: "Better title" })).rows[0] as { id: string }).id;
    expect(await code(revise(st, id, { title: "Even better" }))).toBe("23505");          // one open revision at a time
    await withdraw(st, r1);
    expect(await code(revise(st, id, { title: "Even better" }))).toBe("OK");
  });

  it("the original stays verified and unchanged while the revision is pending, and after it is returned or withdrawn", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "rv4");
    const id = await verified(st, { title: "Keep me" });
    const r1 = ((await revise(st, id, { title: "Changed once" })).rows[0] as { id: string }).id;
    expect(await statusOf(id)).toBe("VERIFIED"); expect(await statusOf(r1)).toBe("SUBMITTED");
    expect(await code(reject(c1, r1))).toBe("OK");
    expect(await statusOf(id)).toBe("VERIFIED");
    const r2 = ((await revise(st, id, { title: "Changed twice" })).rows[0] as { id: string }).id;
    expect(await code(withdraw(st, r2))).toBe("OK");
    expect(await statusOf(id)).toBe("VERIFIED");
    const [o] = await inspect<{ title: string }>("SELECT title FROM student_achievements WHERE id = $1", [id]);
    expect(o.title).toBe("Keep me");
  });

  it("verifying the revision supersedes the original; the revision becomes the verified entry; a superseded entry cannot be revised or decided again", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "rv5");
    const id = await verified(st, { title: "Old" });
    const r = ((await revise(st, id, { title: "New and better", description: "More detail" })).rows[0] as { id: string }).id;
    expect(await code(verify(c2, r))).not.toBe("OK");                                    // another department cannot decide it
    expect(await code(verify(c1, r, "Looks right"))).toBe("OK");
    expect(await statusOf(id)).toBe("SUPERSEDED"); expect(await statusOf(r)).toBe("VERIFIED");
    const [o] = await inspect<{ closed_at: Date | null; reviewed_by: string }>("SELECT closed_at, reviewed_by FROM student_achievements WHERE id = $1", [id]);
    expect(o.closed_at).not.toBeNull(); expect(o.reviewed_by).toBe(c1.userId);          // the original keeps who verified it, and gets a close time
    expect(await code(revise(st, id, { title: "Third attempt" }))).toBe("22023");
    expect(await code(verify(c1, id))).toBe("22023");
    expect(await code(withdraw(st, id))).toBe("22023");
    expect(await code(revise(st, r, { title: "Revise the new one" }))).toBe("OK");       // the chain continues from the current verified entry
    const rows = await inspect<{ status: string }>("SELECT status FROM student_achievements WHERE student_id = $1 AND status IN ('VERIFIED') ", [st.studentId]);
    expect(rows).toHaveLength(1);
  });

  it("superseded entries are frozen even for the owner role, and the revision link is immutable", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "rv6");
    const id = await verified(st, { title: "Frozen" });
    const r = ((await revise(st, id, { title: "Frozen v2" })).rows[0] as { id: string }).id;
    await verify(c1, r);
    expect(await code(adminWrite("UPDATE student_achievements SET status = 'VERIFIED' WHERE id = $1", [id]))).toBe(DENIED);
    expect(await code(adminWrite("UPDATE student_achievements SET closed_at = now() WHERE id = $1", [id]))).toBe(DENIED);
    expect(await code(adminWrite("UPDATE student_achievements SET replaces_id = NULL WHERE id = $1", [r]))).toBe(DENIED);
    expect(await code(adminWrite("UPDATE student_achievements SET status = 'SUPERSEDED', closed_at = now() WHERE id = $1 AND status = 'SUBMITTED'", [r]))).toBe("OK"); // matches no row
    expect(await code(adminWrite("UPDATE student_achievements SET title = 'x' WHERE id = $1", [id]))).toBe(DENIED);
  });

  it("is audited (revise, then verify naming what it replaced) and notifies the department's coordinators", async () => {
    const st = await makeStudentIn(w.A.admin, d1, "rv7");
    const id = await verified(st, { title: "Audit me" });
    const r = ((await revise(st, id, { title: "Audit me v2" })).rows[0] as { id: string }).id;
    await verify(c1, r);
    const log = await inspect<{ action: string; details: { replaces?: string } }>("SELECT action, metadata AS details FROM audit_log WHERE entity_type = 'achievement' AND entity_id = $1 ORDER BY id", [r]);
    expect(log.map((l) => l.action)).toEqual(["ACHIEVEMENT_REVISED", "ACHIEVEMENT_VERIFIED"]);
    expect(log[0].details.replaces).toBe(id); expect(log[1].details.replaces).toBe(id);
    const mine = (await as(st, (t) => sql<{ title: string }>`SELECT title FROM notifications WHERE title = 'An achievement was verified'`.execute(t))).rows.length;
    expect(mine).toBeGreaterThanOrEqual(2);
  });
});

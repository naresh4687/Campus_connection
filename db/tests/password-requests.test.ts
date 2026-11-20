import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { withOwner } from "./helpers";
import { appDb, closeAppDb, code, emailFor, FAKE_HASH, inspect, makeCoordinator, makeDepartment, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let d1: string; let d2: string; let c1: Actor; let c2: Actor;
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, appDb());
const run = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(appDb()));
const request = async (a: Actor) => (await run(a, sql`SELECT auth.request_password_change() AS id`)).rows[0] as { id: string };
const pending = async (a: Actor) => (await run(a, sql`SELECT * FROM auth.pending_password_requests()`)).rows as { id: string; full_name: string }[];
const decide = (a: Actor | null, id: string, yes: boolean) => run(a, sql`SELECT auth.decide_password_request(${id}::uuid, ${yes})`);
const complete = (a: Actor, id: string) => run(a, sql`SELECT auth.complete_password_request(${id}::uuid, ${FAKE_HASH}, null)`);
let n = 0;
const student = (dept: string, _coord?: Actor) => makeStudentIn(w.A.admin, dept, `pw${++n}`);

beforeAll(async () => { w = await seedTwoColleges(); d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin); c1 = await makeCoordinator(w.A.admin, [d1], "pwc1"); c2 = await makeCoordinator(w.A.admin, [d2], "pwc2"); });
afterAll(async () => { await closeAppDb(); });

describe("who can see and decide a password request", () => {
  it("a student's request goes to their department's coordinator, the officers and the administrator; not to another department, another college or the platform", async () => {
    const s = await student(d1, c1); const { id } = await request(s);
    for (const who of [c1, w.A.officer, w.A.admin]) expect((await pending(who)).some((r) => r.id === id), who.role).toBe(true);
    for (const who of [c2, w.B.officer, w.B.admin, w.pa, s]) expect((await pending(who)).some((r) => r.id === id), who.role).toBe(false);
    expect(await code(decide(c2, id, true))).toBe("42501"); expect(await code(decide(w.B.admin, id, true))).toBe("42501"); expect(await code(decide(w.pa, id, true))).toBe("42501"); expect(await code(decide(s, id, true))).toBe("42501");
    expect(await code(request(s))).toBe("22023");                                                      // one open request at a time
  });
  it("a coordinator's or officer's request goes to the college administrator only; the administrator's goes to the platform administrator only", async () => {
    const cq = await request(c1); const oq = await request(w.A.officer);
    for (const id of [cq.id, oq.id]) { expect((await pending(w.A.admin)).some((r) => r.id === id)).toBe(true); expect((await pending(w.A.officer)).some((r) => r.id === id)).toBe(false); expect(await code(decide(w.A.officer, id, true))).toBe("42501"); expect(await code(decide(w.pa, id, true))).toBe("42501"); }
    const aq = await request(w.A.admin);
    expect((await pending(w.pa)).some((r) => r.id === aq.id)).toBe(true); expect((await pending(w.A.admin)).some((r) => r.id === aq.id)).toBe(false);
    expect(await code(decide(w.A.admin, aq.id, true))).toBe("42501"); expect(await code(decide(w.B.admin, aq.id, true))).toBe("42501");
    expect(await code(request(w.pa))).toBe("42501");                                                    // nobody is above the platform administrator
  });
});

describe("approval, the new password, expiry and single use", () => {
  it("approval notifies the requester with a link; the password can be set once, only after approval, only by the requester", async () => {
    const s = await student(d1, c1); const { id } = await request(s);
    expect(await code(complete(s, id))).toBe("22023");                                                  // not approved yet
    await decide(c1, id, true);
    const link = await inspect<{ link: string }>("SELECT link FROM notifications WHERE user_id = $1 AND title = 'Password change approved'", [s.userId]); expect(link[0].link).toBe(`/account/password/${id}`);
    const other = await student(d1, c1); expect(await code(complete(other, id))).toBe("42501");          // someone else's approval is useless
    await complete(s, id);
    expect((await inspect<{ status: string }>("SELECT status FROM password_change_requests WHERE id = $1", [id]))[0].status).toBe("USED");
    expect(await code(complete(s, id))).toBe("22023");                                                  // single use
    expect(await code(decide(c1, id, false))).toBe("22023");                                            // already decided
  });
  it("a declined or expired approval cannot be used; the requester can then ask again", async () => {
    const s = await student(d1, c1); const a = await request(s); await decide(w.A.officer, a.id, false);
    expect(await code(complete(s, a.id))).toBe("22023");
    expect((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM notifications WHERE user_id = $1 AND title = 'Password change declined'", [s.userId]))[0].n).toBe("1");
    const b = await request(s); await decide(c1, b.id, true);
    await withOwner(async (c) => { await c.query("BEGIN"); try { await c.query("SET LOCAL ROLE cc_auth"); await c.query("UPDATE password_change_requests SET expires_at = now() - interval '1 minute' WHERE id = $1", [b.id]); await c.query("COMMIT"); } catch (e) { await c.query("ROLLBACK"); throw e; } });
    expect(await code(complete(s, b.id))).toBe("22023");
    await request(s);                                                                                   // a new request is allowed
  });
});

describe("own name and email", () => {
  it("changes the sign-in email and name (a student's record follows); duplicates and bad input are refused", async () => {
    const s = await student(d1, c1); const mail = emailFor("new"); const other = emailFor("taken");
    await run(s, sql`SELECT auth.update_own_profile('New Name', ${mail}::citext)`);
    const [u] = await inspect<{ full_name: string; email: string }>("SELECT full_name, email::text AS email FROM users WHERE id = $1", [s.userId]); expect(u).toEqual({ full_name: "New Name", email: mail });
    const [r] = await inspect<{ full_name: string; college_email: string }>("SELECT full_name, college_email::text AS college_email FROM students WHERE user_id = $1", [s.userId]); expect(r).toEqual({ full_name: "New Name", college_email: mail });
    const s2 = await student(d1, c1); await run(s2, sql`SELECT auth.update_own_profile('Other', ${other}::citext)`);
    expect(await code(run(s, sql`SELECT auth.update_own_profile('New Name', ${other}::citext)`))).toBe("22023");
    for (const bad of ["not-an-email", ""]) expect(await code(run(s, sql`SELECT auth.update_own_profile('New Name', ${bad}::citext)`))).toBe("22023");
    expect(await code(run(s, sql`SELECT auth.update_own_profile('', ${mail}::citext)`))).toBe("22023");
    expect(await code(run(null, sql`SELECT auth.update_own_profile('X Y', 'a@b.test'::citext)`))).toBe("42501");
  });
});

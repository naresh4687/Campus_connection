import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { hashToken, newToken } from "../../src/server/auth/tokens";
import { appUrl, withOwner } from "./helpers";
import { appDb, closeAppDb, code, inspect, makeCoordinator, makeDepartment, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let dept: string; let coord: Actor; let n = 0;
const run = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? withTenantTx(a, (t) => q.execute(t), appDb()) : q.execute(appDb()));
const rows = async <T>(a: Actor | null, q: ReturnType<typeof sql>) => (await run(a, q)).rows as T[];
const student = () => makeStudentIn(w.A.admin, dept, `prv${++n}`);

beforeAll(async () => {
  process.env.APP_DATABASE_URL = appUrl(); process.env.AUTH_PEPPER ??= "db-test-pepper-0123456789abcdef0123456789";
  w = await seedTwoColleges(); dept = await makeDepartment(w.A.admin); coord = await makeCoordinator(w.A.admin, [dept], "prvc");
});
afterAll(async () => { await closeAppDb(); });

// ───────────── two-step sign-in ─────────────
const enrol = async (a: Actor, hashes = ["aa", "bb"]) => {
  await run(a, sql`SELECT auth.mfa_start_setup('sealed')`);
  await run(a, sql`SELECT auth.mfa_confirm_setup(100, ARRAY(SELECT decode(h, 'hex') FROM unnest(${hashes}::text[]) AS h), null)`);
};
const challenge = async (a: Actor) => { const t = hashToken(newToken()); await run(null, sql`SELECT auth.mfa_begin_challenge(${a.userId}::uuid, ${t})`); return t; };
const tries = async (t: Buffer) => (await rows(null, sql`SELECT * FROM auth.mfa_try_challenge(${t})`)).length;
const finish = async (t: Buffer, step: number | null, rec: string | null) => (await rows<{ ok: boolean }>(null, sql`SELECT auth.mfa_finish_challenge(${t}, ${step}::bigint, decode(${rec}::text, 'hex')) AS ok`))[0].ok;
const enabled = async (a: Actor) => (await rows<{ ok: boolean }>(null, sql`SELECT auth.mfa_enabled(${a.userId}::uuid) AS ok`))[0].ok;

describe("two-step sign-in", () => {
  it("the runtime role cannot read or write the secret tables", async () => {
    for (const q of [sql`SELECT * FROM user_mfa`, sql`SELECT * FROM mfa_recovery_codes`, sql`SELECT * FROM mfa_challenges`, sql`DELETE FROM user_mfa`]) expect(await code(run(w.A.admin, q))).toBe("42501");
  });
  it("a challenge needs enrolment, works once, and a code step or recovery code is never accepted twice", async () => {
    const s = await student();
    expect(await code(challenge(s))).toBe("22023");
    await enrol(s);
    const a = await challenge(s);
    expect(await tries(a)).toBe(1);
    expect(await finish(a, 100, null)).toBe(false);          // the setup code cannot be replayed
    expect(await finish(a, 101, null)).toBe(true);
    expect(await finish(a, 102, null)).toBe(false);          // the challenge is used up
    const b = await challenge(s);
    expect(await finish(b, 101, null)).toBe(false);
    expect(await finish(b, null, "aa")).toBe(true);
    const c = await challenge(s);
    expect(await finish(c, null, "aa")).toBe(false);
    expect(await finish(c, null, "cc")).toBe(false);
  });
  it("allows five tries per challenge, and a newer sign-in replaces the older challenge", async () => {
    const s = await student(); await enrol(s);
    const a = await challenge(s);
    for (let i = 0; i < 5; i++) expect(await tries(a)).toBe(1);
    expect(await tries(a)).toBe(0);
    const b = await challenge(s); const c = await challenge(s);
    expect(await tries(b)).toBe(0); expect(await tries(c)).toBe(1);
  });
  it("administrators cannot switch it off; others can", async () => {
    await enrol(w.B.admin);
    expect(await code(run(w.B.admin, sql`SELECT auth.mfa_disable()`))).toBe("22023");
    const s = await student(); await enrol(s); await run(s, sql`SELECT auth.mfa_disable()`);
    expect(await enabled(s)).toBe(false);
  });
  it("only the right person above can remove it from someone else", async () => {
    const reset = (by: Actor, who: Actor) => code(run(by, sql`SELECT auth.mfa_admin_reset(${who.userId}::uuid)`));
    await enrol(w.A.officer); await enrol(w.A.admin);
    for (const by of [w.B.admin, w.A.officer, coord, w.pa, w.A.student]) expect(await reset(by, w.A.officer), by.role).toBe("42501");
    expect(await reset(w.A.admin, w.A.admin)).toBe("42501");
    expect(await reset(w.A.admin, w.A.officer)).toBe("OK");
    expect(await enabled(w.A.officer)).toBe(false);
    expect(await reset(w.pa, w.A.admin)).toBe("OK");
  });
});

// ───────────── data deletion ─────────────
const request = async (s: Actor) => (await rows<{ id: string }>(s, sql`SELECT privacy.request_erasure() AS id`))[0].id;
const decide = (a: Actor, id: string, yes: boolean, reason: string | null = null) => run(a, sql`SELECT privacy.decide_erasure(${id}::uuid, ${yes}, ${reason})`);
const addFile = async (s: Actor & { studentId: string }, name: string) => {
  const key = `c/${s.collegeId}/s/${s.studentId}/${randomUUID()}`;
  await run(s, sql`SELECT documents.register('RESUME', ${name}, 'application/pdf', 10, ${"a".repeat(64)}, ${key})`);
  return key;
};

/** Every place a string still appears in any application table, except the append-only security log. */
const findEverywhere = async (needle: string) => {
  const tables = await inspect<{ t: string }>("SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename NOT IN ('audit_log', 'schema_migrations')");
  const found: string[] = [];
  for (const { t } of tables) if ((await inspect(`SELECT 1 FROM public.${t} x WHERE position(lower($1) IN lower(x::text)) > 0 LIMIT 1`, [needle])).length) found.push(t);
  return found;
};

describe("data download", () => {
  it("contains the student's own records, no file locations, and nobody else's", async () => {
    const s = await student(); const other = await student();
    await addFile(s, "mine-resume.pdf"); await addFile(other, "theirs-resume.pdf");
    const { exportMyData } = await import("../../src/server/privacy/export");
    const data = await exportMyData({ ...s, sessionId: "", fullName: "", slot: "student", portal: "student" } as never);
    const text = JSON.stringify(data);
    expect(text).toContain("mine-resume.pdf"); expect(text).toContain(s.email);
    expect(text).not.toContain("theirs-resume.pdf"); expect(text).not.toContain(other.email); expect(text).not.toContain(other.studentId);
    expect(text).not.toMatch(/storage_key|sha256|password_hash/);
  });
});

describe("data deletion", () => {
  it("only the student asks; one open request; only their college's administrator decides, and declining needs a reason", async () => {
    const s = await student(); const id = await request(s);
    expect(await code(request(s))).toBe("22023");
    expect(await code(request(w.A.officer))).toBe("42501");
    for (const by of [w.B.admin, w.A.officer, coord, s, w.pa]) expect(await code(decide(by, id, true)), by.role).toBe("42501");
    expect(await rows(w.B.admin, sql`SELECT * FROM privacy.erasure_list()`)).not.toContainEqual(expect.objectContaining({ id }));
    expect(await code(decide(w.A.admin, id, false))).toBe("22023");
    await decide(w.A.admin, id, false, "Placement still running");
    expect(await code(decide(w.A.admin, id, true))).toBe("22023");
    await request(s); await run(s, sql`SELECT privacy.cancel_erasure()`);
    expect(await code(run(s, sql`SELECT privacy.cancel_erasure()`))).toBe("22023");
  });
  it("the internal erase function cannot be called by the app, and the history guards still hold for everyone else", async () => {
    const s = await student(); await addFile(s, "guarded.pdf");
    expect(await code(run(w.A.admin, sql`SELECT privacy.erase_student(${w.A.collegeId}::uuid, ${s.studentId}::uuid, ${s.userId}::uuid)`))).toBe("42501");
    const asOwner = withOwner(async (c) => { await c.query("BEGIN"); try { await c.query("SET LOCAL ROLE cc_auth"); await c.query("UPDATE documents SET original_name = 'x' WHERE student_id = $1", [s.studentId]); } finally { await c.query("ROLLBACK"); } });
    expect(await code(asOwner)).toBe("42501");
  });
  it("approval removes everything identifying, ends access, keeps anonymous records and tracks the files", async () => {
    const s = await student(); const key = await addFile(s, "Zebulon-resume.pdf");
    const name = `Zebulon Quixote ${n}`;
    await run(s, sql`SELECT auth.update_own_profile(${name}, ${s.email}::citext)`);
    await run(s, sql`SELECT students.update_own_contact('+91 91234 56789', 'zebulon.private@example.test')`);
    await run(s, sql`SELECT students.update_own_links('https://github.com/zebulonq', null, null)`);
    await run(s, sql`SELECT auth.request_password_change()`);                       // a staff notification that names them
    const [{ register_number }] = await inspect<{ register_number: string }>("SELECT register_number::text AS register_number FROM students WHERE id = $1", [s.studentId]);
    expect((await findEverywhere(name)).length).toBeGreaterThan(2);
    const id = await request(s);
    await decide(w.A.admin, id, true);
    for (const needle of [name, s.email, "zebulon", "91234 56789", register_number]) expect(await findEverywhere(needle), needle).toEqual([]);
    expect((await inspect("SELECT 1 FROM students WHERE id = $1", [s.studentId])).length).toBe(1);
    expect(await inspect("SELECT status FROM users WHERE id = $1", [s.userId])).toEqual([{ status: "DISABLED" }]);
    expect(await code(run(w.A.admin, sql`SELECT auth.set_user_status(${s.userId}::uuid, 'ACTIVE')`))).not.toBe("OK");
    expect(await rows(w.A.admin, sql`SELECT * FROM privacy.erasure_files(${id}::uuid)`)).toEqual([{ storage_key: key }]);
    expect(await code(run(w.B.admin, sql`SELECT privacy.mark_file_erased(${id}::uuid, ${key})`))).toBe("42501");
    await run(w.A.admin, sql`SELECT privacy.mark_file_erased(${id}::uuid, ${key})`);
    expect(await rows(w.A.admin, sql`SELECT * FROM privacy.erasure_files(${id}::uuid)`)).toEqual([]);
  });
});

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { hashToken, newToken } from "../../src/server/auth/tokens";
import { withOwner } from "./helpers";
import { appDb, closeAppDb, createCollege, createUser, emailFor, FAKE_HASH, inspect, platformAdmin, seedTwoColleges, uniq, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());

/** Runs a write as cc_auth (BYPASSRLS definer role) to simulate the passage of time / tampering by a DBA. */
async function adminWrite(text: string, params: unknown[] = []) {
  await withOwner(async (c) => {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE cc_auth");
    await c.query(text, params);
    await c.query("COMMIT");
  });
}

async function code(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    return (e as { code?: string }).code ?? `no-code:${(e as Error).message}`;
  }
  return "OK";
}
const DENIED = "42501";

const invite = (actor: Actor, email: string, role: string, college: string | null, token = newToken(), ttl = 3600) =>
  as(actor, (t) => sql`SELECT auth.create_invitation(${email}, ${role}, ${college}::uuid, ${hashToken(token)}, ${ttl})`.execute(t));

async function login(userId: string) {
  const token = newToken();
  await sql`SELECT auth.create_session(${userId}::uuid, ${hashToken(token)}, 1800, 43200, ${null}, ${"vitest"})`.execute(db());
  return token;
}
const resolve = async (token: string) => (await sql<{ user_id: string; role: string }>`SELECT * FROM auth.resolve_session(${hashToken(token)})`.execute(db())).rows[0];

beforeAll(async () => { w = await seedTwoColleges(); });
afterAll(async () => { await closeAppDb(); });

describe("bootstrap", () => {
  it("exists once, and the runtime role cannot call it", async () => {
    await platformAdmin();
    expect(await code(withOwner((c) => c.query("SELECT auth.bootstrap_platform_admin($1,$2,$3)", [emailFor("second"), "X", FAKE_HASH])))).toBe("23505");
    expect(await code(sql`SELECT auth.bootstrap_platform_admin(${emailFor("x")}, 'X', ${FAKE_HASH})`.execute(db()))).toBe(DENIED);
  });
});

describe("direct table access by the runtime role is closed", () => {
  it("cannot read credential/session/rate-limit tables or users.password_hash", async () => {
    for (const t of ["sessions", "password_resets", "rate_limits"]) expect(await code(sql.raw(`SELECT * FROM ${t}`).execute(db()))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`SELECT password_hash FROM users`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`SELECT * FROM users`.execute(t)))).toBe(DENIED); // `*` includes password_hash
  });

  it("cannot INSERT, DELETE or re-role users, even for itself", async () => {
    const me = w.A.student;
    expect(await code(as(me, (t) => sql`INSERT INTO users (college_id,email,full_name,password_hash,role) VALUES (${me.collegeId},'evil@example.test','E',${FAKE_HASH},'COLLEGE_ADMIN')`.execute(t)))).toBe(DENIED);
    expect(await code(as(me, (t) => sql`DELETE FROM users WHERE id = ${me.userId}`.execute(t)))).toBe(DENIED);
    for (const col of ["role = 'COLLEGE_ADMIN'", "role = 'PLATFORM_SUPER_ADMIN'", `college_id = '${w.B.collegeId}'`, "status = 'ACTIVE'", "email = 'new@example.test'", `password_hash = '${FAKE_HASH}'`]) {
      expect(await code(as(me, (t) => sql.raw(`UPDATE users SET ${col} WHERE id = '${me.userId}'`).execute(t))), col).toBe(DENIED);
    }
    const [row] = await inspect<{ role: string; college_id: string }>("SELECT role, college_id FROM users WHERE id = $1", [me.userId]);
    expect(row).toEqual({ role: "STUDENT", college_id: w.A.collegeId });
  });

  it("cannot rename anyone — itself included — with a direct statement (names change only through administrator workflows)", async () => {
    for (const who of [w.A.student, w.A.admin, w.pa]) expect(await code(as(who, (t) => sql`UPDATE users SET full_name = 'Renamed' WHERE id = ${who.userId}`.execute(t))), who.role).toBe(DENIED);
    expect(await code(as(w.A.student, (t) => sql`UPDATE users SET full_name = 'Hacked' WHERE id = ${w.A.admin.userId}`.execute(t)))).toBe(DENIED);
  });

  it("cannot insert invitations or password resets directly", async () => {
    expect(await code(as(w.A.admin, (t) => sql`INSERT INTO invitations (email,role,college_id,invited_by,token_hash,expires_at) VALUES ('x@example.test','STUDENT',${w.A.collegeId},${w.A.admin.userId},'\\x00',now()+interval '1 day')`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`INSERT INTO password_resets (user_id,issued_by,token_hash,expires_at) VALUES (${w.A.student.userId},${w.A.admin.userId},'\\x00',now()+interval '1 day')`.execute(t)))).toBe(DENIED);
  });

  it("cannot call internal-only functions", async () => {
    expect(await code(sql`SELECT auth.write_audit('PLATFORM', NULL, NULL, NULL, 'FORGED_EVENT', NULL, NULL, '{}'::jsonb, NULL)`.execute(db()))).toBe(DENIED);
  });
});

describe("invitation authorisation matrix", () => {
  const roles = ["COLLEGE_ADMIN", "PLACEMENT_OFFICER", "COORDINATOR", "STUDENT"] as const;
  type Who = "pa" | "adminA" | "officerA" | "coordA" | "studentA";
  const actorOf = (k: Who): Actor => ({ pa: w.pa, adminA: w.A.admin, officerA: w.A.officer, coordA: w.A.coordinator, studentA: w.A.student })[k];
  // who may invite which role INTO college A
  const allowed: Record<Who, readonly string[]> = {
    pa: ["COLLEGE_ADMIN"],
    adminA: ["PLACEMENT_OFFICER", "COORDINATOR"],   // STUDENT invitations come from the student record (see students.test.ts)
    officerA: [],
    coordA: [],
    studentA: [],
  };
  for (const who of Object.keys(allowed) as Who[]) {
    for (const role of roles) {
      const should = allowed[who].includes(role);
      it(`${who} inviting ${role} into college A -> ${should ? "allowed" : "denied"}`, async () => {
        const c = await code(invite(actorOf(who), emailFor("m"), role, w.A.collegeId));
        expect(c).toBe(should ? "OK" : DENIED);
      });
    }
  }

  it("nobody can create a STUDENT invitation through the free-form function — not even the college admin", async () => {
    for (const a of [w.pa, w.A.admin, w.A.officer]) expect(await code(invite(a, emailFor("stu"), "STUDENT", w.A.collegeId))).toBe(DENIED);
  });

  it("nobody can invite a PLATFORM_SUPER_ADMIN (rejected by function and by CHECK)", async () => {
    for (const a of [w.pa, w.A.admin]) expect(["42501", "23514"]).toContain(await code(invite(a, emailFor("p"), "PLATFORM_SUPER_ADMIN", w.A.collegeId)));
  });

  it("a college admin cannot invite into another college", async () => {
    expect(await code(invite(w.A.admin, emailFor("x"), "STUDENT", w.B.collegeId))).toBe(DENIED);
  });

  it("an unauthenticated (no context) caller cannot invite", async () => {
    expect(await code(sql`SELECT auth.create_invitation(${emailFor("u")}, 'STUDENT', ${w.A.collegeId}::uuid, ${hashToken(newToken())}, 3600)`.execute(db()))).toBe(DENIED);
  });

  it("refuses an email that already has an account, and out-of-range lifetimes", async () => {
    expect(await code(invite(w.A.admin, w.B.student.email, "COORDINATOR", w.A.collegeId))).toBe("23505");
    expect(await code(invite(w.A.admin, emailFor("t"), "COORDINATOR", w.A.collegeId, newToken(), 5))).toBe("22023");
    expect(await code(invite(w.A.admin, emailFor("t"), "COORDINATOR", w.A.collegeId, newToken(), 60 * 60 * 24 * 365))).toBe("22023");
  });

  it("cannot invite into a suspended college", async () => {
    const cid = await createCollege();
    const admin = await createUser(w.pa, "COLLEGE_ADMIN", cid, "susp-admin");
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'SUSPENDED', 'suspended by the test suite')`.execute(t));
    expect(await code(invite(w.pa, emailFor("s"), "COLLEGE_ADMIN", cid))).toBe("22023");
    // and the suspended college's own admin loses all database authority (fail closed)
    await expect(as(admin, async () => 1)).rejects.toThrow(/does not match/);
  });
});

describe("invitation acceptance", () => {
  it("never stores the plaintext token; stores only its SHA-256", async () => {
    const token = newToken();
    const email = emailFor("hash");
    await invite(w.A.admin, email, "COORDINATOR", w.A.collegeId, token);
    const dump = JSON.stringify(await inspect("SELECT i.*, encode(token_hash,'hex') AS hex FROM invitations i WHERE email = $1", [email]));
    expect(dump).not.toContain(token);
    expect(dump).toContain(hashToken(token).toString("hex"));
  });

  it("creates the account with the INVITED role and college; the acceptor chooses neither", async () => {
    const token = newToken();
    const email = emailFor("who");
    await invite(w.A.admin, email, "COORDINATOR", w.A.collegeId, token);
    const r = await sql<{ role: string; college_id: string }>`SELECT * FROM auth.accept_invitation(${hashToken(token)}, 'New Person', ${FAKE_HASH})`.execute(db());
    expect(r.rows[0]).toMatchObject({ role: "COORDINATOR", college_id: w.A.collegeId });
  });

  it("is single-use, and rejects wrong, expired, revoked and superseded tokens", async () => {
    const t1 = newToken();
    await invite(w.A.admin, emailFor("once"), "COORDINATOR", w.A.collegeId, t1);
    await sql`SELECT * FROM auth.accept_invitation(${hashToken(t1)}, 'A', ${FAKE_HASH})`.execute(db());
    expect(await code(sql`SELECT * FROM auth.accept_invitation(${hashToken(t1)}, 'A', ${FAKE_HASH})`.execute(db()))).toBe("P0001");
    expect(await code(sql`SELECT * FROM auth.accept_invitation(${hashToken(newToken())}, 'A', ${FAKE_HASH})`.execute(db()))).toBe("P0001");

    const exp = newToken(); const expEmail = emailFor("exp");
    await invite(w.A.admin, expEmail, "COORDINATOR", w.A.collegeId, exp);
    await adminWrite("UPDATE invitations SET expires_at = now() - interval '1 second' WHERE email = $1", [expEmail]);
    expect(await code(sql`SELECT * FROM auth.accept_invitation(${hashToken(exp)}, 'A', ${FAKE_HASH})`.execute(db()))).toBe("P0001");

    const sup1 = newToken(); const sup2 = newToken(); const supEmail = emailFor("sup");
    await invite(w.A.admin, supEmail, "COORDINATOR", w.A.collegeId, sup1);
    await invite(w.A.admin, supEmail, "COORDINATOR", w.A.collegeId, sup2);           // re-issue revokes the first
    expect(await code(sql`SELECT * FROM auth.accept_invitation(${hashToken(sup1)}, 'A', ${FAKE_HASH})`.execute(db()))).toBe("P0001");
    expect(await code(sql`SELECT * FROM auth.accept_invitation(${hashToken(sup2)}, 'A', ${FAKE_HASH})`.execute(db()))).toBe("OK");
  });

  it("rejects non-Argon2id password hashes (no plaintext/legacy hashes in the table)", async () => {
    const token = newToken();
    await invite(w.A.admin, emailFor("pw"), "COORDINATOR", w.A.collegeId, token);
    expect(await code(sql`SELECT * FROM auth.accept_invitation(${hashToken(token)}, 'A', 'plaintext-password')`.execute(db()))).toBe("22023");
  });

  it("two simultaneous acceptances of one token create exactly one account", async () => {
    const token = newToken(); const email = emailFor("race");
    await invite(w.A.admin, email, "COORDINATOR", w.A.collegeId, token);
    const results = await Promise.all(Array.from({ length: 6 }, () => code(sql`SELECT * FROM auth.accept_invitation(${hashToken(token)}, 'R', ${FAKE_HASH})`.execute(db()))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect((await inspect("SELECT 1 FROM users WHERE email = $1", [email]))).toHaveLength(1);
  });

  it("a platform-admin invitation for a college admin cannot be used to join another college", async () => {
    const token = newToken(); const email = emailFor("ca");
    await invite(w.pa, email, "COLLEGE_ADMIN", w.B.collegeId, token);
    const r = await sql<{ college_id: string; role: string }>`SELECT * FROM auth.accept_invitation(${hashToken(token)}, 'CA', ${FAKE_HASH})`.execute(db());
    expect(r.rows[0]).toMatchObject({ college_id: w.B.collegeId, role: "COLLEGE_ADMIN" });
  });
});

describe("sessions", () => {
  it("stores only a hash of the session token and resolves it back to the right user", async () => {
    const token = await login(w.A.student.userId);
    expect(JSON.stringify(await inspect("SELECT * FROM sessions WHERE user_id = $1", [w.A.student.userId]))).not.toContain(token);
    expect(await resolve(token)).toMatchObject({ user_id: w.A.student.userId, role: "STUDENT" });
    expect(await resolve(newToken())).toBeUndefined();
  });

  it("expires on idle timeout and on absolute timeout", async () => {
    const idle = await login(w.A.officer.userId);
    await adminWrite("UPDATE sessions SET last_seen_at = now() - interval '31 minutes' WHERE token_hash = $1", [hashToken(idle)]);
    expect(await resolve(idle)).toBeUndefined();
    const abs = await login(w.A.officer.userId);
    await adminWrite("UPDATE sessions SET expires_at = now() - interval '1 second' WHERE token_hash = $1", [hashToken(abs)]);
    expect(await resolve(abs)).toBeUndefined();
  });

  it("is revocable (logout)", async () => {
    const t = await login(w.A.student.userId);
    await sql`SELECT auth.revoke_session(${hashToken(t)})`.execute(db());
    expect(await resolve(t)).toBeUndefined();
  });

  it("dies immediately when the user is disabled, and when the college is suspended", async () => {
    const cid = await createCollege();
    const admin = await createUser(w.pa, "COLLEGE_ADMIN", cid, "sess-admin");
    const stu = await createUser(admin, "STUDENT", cid, "sess-stu");
    const t1 = await login(stu.userId); const t2 = await login(admin.userId);
    expect(await resolve(t1)).toBeDefined();
    await as(admin, (t) => sql`SELECT auth.set_user_status(${stu.userId}::uuid, 'DISABLED')`.execute(t));
    expect(await resolve(t1)).toBeUndefined();
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'SUSPENDED', 'suspended by the test suite')`.execute(t));
    expect(await resolve(t2)).toBeUndefined();
    expect(await code(sql`SELECT auth.create_session(${admin.userId}::uuid, ${hashToken(newToken())}, 1800, 43200, null, null)`.execute(db()))).toBe(DENIED);
  });

  it("cannot be created for a disabled user", async () => {
    const stu = await createUser(w.A.admin, "STUDENT", w.A.collegeId, "dis");
    await as(w.A.admin, (t) => sql`SELECT auth.set_user_status(${stu.userId}::uuid, 'DISABLED')`.execute(t));
    expect(await code(sql`SELECT auth.create_session(${stu.userId}::uuid, ${hashToken(newToken())}, 1800, 43200, null, null)`.execute(db()))).toBe(DENIED);
  });
});

describe("login lookup", () => {
  it("is case-insensitive and returns nothing for unknown emails", async () => {
    const r = await sql<{ id: string }>`SELECT * FROM auth.get_login_user(${w.A.student.email.toUpperCase()})`.execute(db());
    expect(r.rows[0]?.id).toBe(w.A.student.userId);
    expect((await sql`SELECT * FROM auth.get_login_user(${"nobody@example.test"})`.execute(db())).rows).toHaveLength(0);
  });
});

describe("row visibility per role (users, colleges)", () => {
  const ids = async (a: Actor) => (await as(a, (t) => sql<{ id: string }>`SELECT id FROM users ORDER BY id`.execute(t))).rows.map((r) => r.id).sort();
  it("student, officer and coordinator see only themselves", async () => {
    for (const a of [w.A.student, w.A.officer, w.A.coordinator, w.B.student]) expect(await ids(a)).toEqual([a.userId]);
  });
  it("a college admin sees exactly their own college's users", async () => {
    const mine = (await inspect<{ id: string }>("SELECT id FROM users WHERE college_id = $1", [w.A.collegeId])).map((r) => r.id).sort();
    expect(await ids(w.A.admin)).toEqual(mine);
    const theirs = new Set((await inspect<{ id: string }>("SELECT id FROM users WHERE college_id = $1", [w.B.collegeId])).map((r) => r.id));
    expect((await ids(w.A.admin)).some((id) => theirs.has(id))).toBe(false);
  });
  it("a platform admin sees platform admins and college admins only — never students, officers or coordinators", async () => {
    const roles = (await as(w.pa, (t) => sql<{ role: string }>`SELECT DISTINCT role FROM users`.execute(t))).rows.map((r) => r.role).sort();
    expect(roles).toEqual(["COLLEGE_ADMIN", "PLATFORM_SUPER_ADMIN"]);
  });
  it("colleges: tenants see only their own row, the platform sees all, and only the platform can write", async () => {
    const own = async (a: Actor) => (await as(a, (t) => sql<{ id: string }>`SELECT id FROM colleges`.execute(t))).rows.map((r) => r.id);
    expect(await own(w.A.student)).toEqual([w.A.collegeId]);
    expect(await own(w.B.admin)).toEqual([w.B.collegeId]);
    expect((await own(w.pa)).length).toBeGreaterThanOrEqual(2);
    expect(await code(as(w.A.admin, (t) => sql`INSERT INTO colleges (name) VALUES ('Rogue College')`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`UPDATE colleges SET name = 'Renamed by tenant', status = 'SUSPENDED' WHERE id = ${w.A.collegeId}`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.pa, (t) => sql`UPDATE colleges SET status = 'SUSPENDED' WHERE id = ${w.A.collegeId}`.execute(t)))).toBe(DENIED); // even the platform must use the audited function
    expect(await code(as(w.pa, (t) => sql`UPDATE colleges SET id = gen_random_uuid() WHERE id = ${w.A.collegeId}`.execute(t)))).toBe(DENIED);
  });
  it("invitations are visible only to the inviting college admin / platform (college-admin invites), never across colleges", async () => {
    const t = newToken(); const email = emailFor("vis");
    await invite(w.A.admin, email, "COORDINATOR", w.A.collegeId, t);
    const seen = async (a: Actor) => (await as(a, (x) => sql`SELECT id FROM invitations WHERE email = ${email}`.execute(x))).rows.length;
    expect(await seen(w.A.admin)).toBe(1);
    expect(await seen(w.B.admin)).toBe(0);
    expect(await seen(w.A.student)).toBe(0);
    expect(await seen(w.pa)).toBe(0); // platform sees only COLLEGE_ADMIN invitations
  });
});

describe("account administration (disable / reset)", () => {
  it("set_user_status: allowed only within the permission matrix", async () => {
    const stu = await createUser(w.A.admin, "STUDENT", w.A.collegeId, "tgt");
    expect(await code(as(w.A.officer, (t) => sql`SELECT auth.set_user_status(${stu.userId}::uuid, 'DISABLED')`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.student, (t) => sql`SELECT auth.set_user_status(${stu.userId}::uuid, 'DISABLED')`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.B.admin, (t) => sql`SELECT auth.set_user_status(${stu.userId}::uuid, 'DISABLED')`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.pa, (t) => sql`SELECT auth.set_user_status(${stu.userId}::uuid, 'DISABLED')`.execute(t)))).toBe(DENIED); // platform never manages students
    expect(await code(as(w.A.admin, (t) => sql`SELECT auth.set_user_status(${w.A.admin.userId}::uuid, 'DISABLED')`.execute(t)))).toBe(DENIED); // not self
    expect(await code(as(w.A.admin, (t) => sql`SELECT auth.set_user_status(${w.A.admin.userId}::uuid, 'ACTIVE')`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`SELECT auth.set_user_status(${stu.userId}::uuid, 'DISABLED')`.execute(t)))).toBe("OK");
    expect((await inspect<{ status: string }>("SELECT status FROM users WHERE id = $1", [stu.userId]))[0].status).toBe("DISABLED");
    expect(await code(as(w.pa, (t) => sql`SELECT auth.set_user_status(${w.B.admin.userId}::uuid, 'ACTIVE')`.execute(t)))).toBe("OK");
  });

  it("issue_password_reset: same matrix, never self, never for other tenants", async () => {
    const stu = await createUser(w.A.admin, "STUDENT", w.A.collegeId, "rst");
    const issue = (a: Actor, target: string) => as(a, (t) => sql`SELECT auth.issue_password_reset(${target}::uuid, ${hashToken(newToken())}, 3600)`.execute(t));
    expect(await code(issue(w.A.student, stu.userId))).toBe(DENIED);
    expect(await code(issue(w.A.officer, stu.userId))).toBe(DENIED);
    expect(await code(issue(w.B.admin, stu.userId))).toBe(DENIED);
    expect(await code(issue(w.pa, stu.userId))).toBe(DENIED);
    expect(await code(issue(w.A.admin, w.A.admin.userId))).toBe(DENIED);
    expect(await code(issue(w.A.admin, w.pa.userId))).toBe(DENIED);
    expect(await code(issue(w.A.admin, stu.userId))).toBe("OK");
    expect(await code(issue(w.pa, w.A.admin.userId))).toBe("OK");
    expect(await code(issue(w.B.admin, w.A.admin.userId))).toBe(DENIED);
  });

  it("password reset is single-use, expires, stores only the token hash, replaces the password and signs the user out everywhere", async () => {
    const stu = await createUser(w.A.admin, "STUDENT", w.A.collegeId, "rst2");
    const session = await login(stu.userId);
    const token = newToken();
    await as(w.A.admin, (t) => sql`SELECT auth.issue_password_reset(${stu.userId}::uuid, ${hashToken(token)}, 3600)`.execute(t));
    expect(JSON.stringify(await inspect("SELECT * FROM password_resets WHERE user_id = $1", [stu.userId]))).not.toContain(token);
    const newHash = FAKE_HASH.replace("ZmFrZWhhc2g", "bmV3aGFzaG5l");
    await sql`SELECT auth.complete_password_reset(${hashToken(token)}, ${newHash})`.execute(db());
    expect((await inspect<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [stu.userId]))[0].password_hash).toBe(newHash);
    expect(await resolve(session)).toBeUndefined();
    expect(await code(sql`SELECT auth.complete_password_reset(${hashToken(token)}, ${newHash})`.execute(db()))).toBe("P0001"); // reuse

    const t2 = newToken();
    await as(w.A.admin, (t) => sql`SELECT auth.issue_password_reset(${stu.userId}::uuid, ${hashToken(t2)}, 3600)`.execute(t));
    await adminWrite("UPDATE password_resets SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND used_at IS NULL", [stu.userId]);
    expect(await code(sql`SELECT auth.complete_password_reset(${hashToken(t2)}, ${newHash})`.execute(db()))).toBe("P0001");
    expect(await code(sql`SELECT auth.complete_password_reset(${hashToken(newToken())}, 'plain')`.execute(db()))).toBe("22023");
  });

  it("issuing a new reset invalidates the previous one", async () => {
    const stu = await createUser(w.A.admin, "STUDENT", w.A.collegeId, "rst3");
    const a = newToken(); const b = newToken();
    for (const t of [a, b]) await as(w.A.admin, (x) => sql`SELECT auth.issue_password_reset(${stu.userId}::uuid, ${hashToken(t)}, 3600)`.execute(x));
    expect(await code(sql`SELECT auth.complete_password_reset(${hashToken(a)}, ${FAKE_HASH})`.execute(db()))).toBe("P0001");
    expect(await code(sql`SELECT auth.complete_password_reset(${hashToken(b)}, ${FAKE_HASH})`.execute(db()))).toBe("OK");
  });

  it("change_own_password changes only the caller's password and keeps only the current session", async () => {
    const me = await createUser(w.A.admin, "STUDENT", w.A.collegeId, "chg");
    const other = await createUser(w.A.admin, "STUDENT", w.A.collegeId, "chg-other");
    const keep = await login(me.userId); const drop = await login(me.userId); const otherSession = await login(other.userId);
    const h = FAKE_HASH.replace("ZmFrZWhhc2g", "Y2hhbmdlZGhhc2g");
    await as(me, (t) => sql`SELECT auth.change_own_password(${h}, ${hashToken(keep)})`.execute(t));
    expect((await inspect<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [me.userId]))[0].password_hash).toBe(h);
    expect((await inspect<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [other.userId]))[0].password_hash).toBe(FAKE_HASH);
    expect(await resolve(keep)).toBeDefined();
    expect(await resolve(drop)).toBeUndefined();
    expect(await resolve(otherSession)).toBeDefined();
    expect(await code(sql`SELECT auth.change_own_password(${h}, null)`.execute(db()))).toBe(DENIED); // no context
  });
});

describe("audit log", () => {
  it("records security-relevant actions with actor, scope and tenant", async () => {
    const stu = await createUser(w.A.admin, "STUDENT", w.A.collegeId, "aud");
    await as(w.A.admin, (t) => sql`SELECT auth.set_user_status(${stu.userId}::uuid, 'DISABLED')`.execute(t));
    const rows = await inspect<{ action: string; scope: string; college_id: string | null; actor_user_id: string }>(
      "SELECT action, scope, college_id, actor_user_id FROM audit_log WHERE college_id = $1 ORDER BY id", [w.A.collegeId]);
    const actions = rows.map((r) => r.action);
    expect(actions).toEqual(expect.arrayContaining(["INVITATION_CREATED", "INVITATION_ACCEPTED", "USER_DISABLED"]));
    expect(rows.every((r) => r.scope === "COLLEGE")).toBe(true);
    const platformRows = (await inspect<{ action: string }>("SELECT action FROM audit_log WHERE scope = 'PLATFORM'")).map((r) => r.action);
    expect(platformRows).toContain("PLATFORM_ADMIN_BOOTSTRAPPED");
  });

  it("is isolated per tenant: A's admin sees A's events only, B's none of A's, others see nothing", async () => {
    const count = async (a: Actor) => (await as(a, (t) => sql<{ college_id: string | null }>`SELECT college_id FROM audit_log`.execute(t))).rows;
    const a = await count(w.A.admin);
    expect(a.length).toBeGreaterThan(0);
    expect(a.every((r) => r.college_id === w.A.collegeId)).toBe(true);
    expect((await count(w.B.admin)).every((r) => r.college_id === w.B.collegeId)).toBe(true);
    for (const nobody of [w.A.student, w.A.officer, w.A.coordinator]) expect(await count(nobody)).toEqual([]);
    const platform = await count(w.pa);
    expect(platform.every((r) => r.college_id === null)).toBe(true);
  });

  it("cannot be written directly by anyone: entries come only from the definer function, which takes actor, role and tenant from the session", async () => {
    const ins = (a: Actor, scope: string, college: string | null, actor: string, role: string) =>
      as(a, (t) => sql`INSERT INTO audit_log (scope, college_id, actor_user_id, actor_role, action) VALUES (${scope}, ${college}::uuid, ${actor}::uuid, ${role}, 'CUSTOM_EVENT')`.execute(t));
    expect(await code(ins(w.A.admin, "COLLEGE", w.A.collegeId, w.A.admin.userId, "COLLEGE_ADMIN"))).toBe(DENIED);   // even a perfectly honest-looking entry
    expect(await code(ins(w.A.admin, "COLLEGE", w.A.collegeId, w.B.admin.userId, "COLLEGE_ADMIN"))).toBe(DENIED);   // spoofed actor
    expect(await code(ins(w.pa, "PLATFORM", null, w.pa.userId, "PLATFORM_SUPER_ADMIN"))).toBe(DENIED);
  });

  it("is append-only: UPDATE/DELETE are not granted and TRUNCATE is blocked even for the owner", async () => {
    expect(await code(as(w.A.admin, (t) => sql`UPDATE audit_log SET action = 'EDITED'`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`DELETE FROM audit_log`.execute(t)))).toBe(DENIED);
    expect(await code(withOwner((c) => c.query("TRUNCATE audit_log")))).toBe(DENIED);
    const triggers = await inspect<{ tgname: string }>("SELECT tgname FROM pg_trigger WHERE tgrelid = 'audit_log'::regclass AND NOT tgisinternal");
    expect(triggers.map((t) => t.tgname).sort()).toEqual(["audit_no_truncate", "audit_no_update_delete"]);
  });

  it("auth events are logged only from the whitelist", async () => {
    expect(await code(sql`SELECT auth.log_auth_event(${w.A.student.userId}::uuid, 'LOGIN_FAILED', null, '{}'::jsonb)`.execute(db()))).toBe("OK");
    expect(await code(sql`SELECT auth.log_auth_event(${w.A.student.userId}::uuid, 'PRIVILEGE_GRANTED', null, '{}'::jsonb)`.execute(db()))).toBe("22023");
  });
});

describe("rate limiter", () => {
  it("allows up to the limit, then blocks; keys are independent", async () => {
    const key = uniq("rl");
    const hit = async (k: string) => (await sql<{ ok: boolean }>`SELECT auth.rate_limit_check(${k}, 3, 60) AS ok`.execute(db())).rows[0].ok;
    expect([await hit(key), await hit(key), await hit(key), await hit(key), await hit(key)]).toEqual([true, true, true, false, false]);
    expect(await hit(uniq("rl-other"))).toBe(true);
  });
  it("is concurrency-safe: 20 parallel calls with limit 5 allow exactly 5", async () => {
    const key = uniq("rl-par");
    const res = await Promise.all(Array.from({ length: 20 }, async () => (await sql<{ ok: boolean }>`SELECT auth.rate_limit_check(${key}, 5, 60) AS ok`.execute(db())).rows[0].ok));
    expect(res.filter(Boolean)).toHaveLength(5);
  });
  it("rejects nonsensical configuration", async () => {
    expect(await code(sql`SELECT auth.rate_limit_check('k', 0, 60)`.execute(db()))).not.toBe("OK");
    expect(await code(sql`SELECT auth.rate_limit_check('k', 5, 0)`.execute(db()))).not.toBe("OK");
  });
});

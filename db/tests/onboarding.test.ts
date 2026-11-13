import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { hashToken, newToken } from "../../src/server/auth/tokens";
import { adminWrite, appDb, closeAppDb, code, createCollege, createUser, DENIED, emailFor, FAKE_HASH, inspect, platformAdmin, seedTwoColleges, submitApplication, uniq, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const reviewed = async (over: Parameters<typeof submitApplication>[0] = {}) => {
  const a = await submitApplication(over);
  await as(w.pa, (t) => sql`SELECT platform.start_review(${a.id}::uuid)`.execute(t));
  return a;
};
const rowOf = async (id: string) => (await inspect<{ status: string; college_id: string | null; decision_reason: string | null }>("SELECT status, college_id, decision_reason FROM college_applications WHERE id = $1", [id]))[0];

beforeAll(async () => { w = await seedTwoColleges(); });
afterAll(async () => { await closeAppDb(); });

describe("public application submission", () => {
  it("stores a SUBMITTED application and only the hash of the status-link token", async () => {
    const a = await submitApplication();
    expect((await rowOf(a.id)).status).toBe("SUBMITTED");
    const dump = JSON.stringify(await inspect("SELECT *, encode(reference_hash,'hex') AS h FROM college_applications WHERE id = $1", [a.id]));
    expect(dump).not.toContain(a.token);
    expect(dump).toContain(hashToken(a.token).toString("hex"));
  });

  const bad: [string, Parameters<typeof submitApplication>[0]][] = [
    ["javascript: website", { website: "javascript:alert(1)" }],
    ["ftp website", { website: "ftp://files.example.test" }],
    ["website with whitespace/script", { website: "https://a.test/ <script>" }],
    ["data: website", { website: "data:text/html,<script>1</script>" }],
    ["letters in phone", { phone: "call me maybe" }],
    ["too-short phone", { phone: "123" }],
    ["tiny student strength", { students: 5 }],
    ["absurd student strength", { students: 10_000_000 }],
    ["unknown college type", { type: "HACKERSPACE" }],
    ["one-letter name", { name: "X" }],
    ["email without @", { email: "not-an-email" }],
    ["oversized name", { name: "N".repeat(201) }],
  ];
  for (const [label, over] of bad) {
    it(`rejects ${label} at the database (CHECK 23514)`, async () => {
      expect(await code(submitApplication(over))).toBe("23514");
    });
  }

  it("allows only one live application per official email (case-insensitive), but a rejected one may re-apply", async () => {
    const email = emailFor("dup");
    const first = await submitApplication({ email });
    expect(await code(submitApplication({ email: email.toUpperCase() }))).toBe("23505");
    await as(w.pa, (t) => sql`SELECT platform.start_review(${first.id}::uuid)`.execute(t));
    await as(w.pa, (t) => sql`SELECT platform.reject_application(${first.id}::uuid, 'Incomplete details supplied')`.execute(t));
    expect(await code(submitApplication({ email }))).toBe("OK");
  });

  it("an approved email cannot apply again", async () => {
    const email = emailFor("approved-dup");
    const a = await reviewed({ email });
    await as(w.pa, (t) => sql`SELECT platform.approve_application(${a.id}::uuid)`.execute(t));
    expect(await code(submitApplication({ email }))).toBe("23505");
  });

  it("the public status lookup reveals only status data, only for the holder of the token", async () => {
    const a = await reviewed();
    const look = async (t: string) => (await sql<Record<string, unknown>>`SELECT * FROM platform.application_status(${hashToken(t)})`.execute(db())).rows;
    const [row] = await look(a.token);
    expect(Object.keys(row).sort()).toEqual(["decided_at", "decision_reason", "name", "status", "submitted_at"]);
    expect(row.status).toBe("UNDER_REVIEW");
    expect(await look(newToken())).toEqual([]);
    await as(w.pa, (t) => sql`SELECT platform.reject_application(${a.id}::uuid, 'Not an engineering institution')`.execute(t));
    expect((await look(a.token))[0]).toMatchObject({ status: "REJECTED", decision_reason: "Not an engineering institution" });
  });

  it("does not show the internal decision reason of an application that is not rejected", async () => {
    const a = await submitApplication();
    expect((await sql<{ decision_reason: string | null }>`SELECT * FROM platform.application_status(${hashToken(a.token)})`.execute(db())).rows[0].decision_reason).toBeNull();
  });
});

describe("who can see or touch applications", () => {
  it("only a platform admin can read them; nobody else, not even with a context", async () => {
    await submitApplication();
    const n = async (a: Actor | null) => (await call(a, sql`SELECT count(*)::int AS n FROM college_applications`).catch(() => ({ rows: [{ n: -1 }] }))).rows[0] as { n: number };
    expect((await n(w.pa)).n).toBeGreaterThan(0);
    for (const a of [w.A.admin, w.A.officer, w.A.coordinator, w.A.student, w.B.admin]) expect((await n(a)).n).toBe(0);
    expect((await n(null)).n).toBeLessThanOrEqual(0); // no privilege or no rows
  });

  it("the status-link hash is not readable by anyone, including the platform admin", async () => {
    expect(await code(as(w.pa, (t) => sql`SELECT reference_hash FROM college_applications`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.pa, (t) => sql`SELECT * FROM college_applications`.execute(t)))).toBe(DENIED);
  });

  it("the runtime role cannot INSERT, UPDATE or DELETE applications directly, even as platform admin", async () => {
    const a = await submitApplication();
    expect(await code(as(w.pa, (t) => sql`UPDATE college_applications SET status = 'APPROVED' WHERE id = ${a.id}`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.pa, (t) => sql`DELETE FROM college_applications WHERE id = ${a.id}`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.pa, (t) => sql`INSERT INTO college_applications (reference_hash, name) VALUES ('\\x01', 'x')`.execute(t)))).toBe(DENIED);
  });
});

describe("application state machine", () => {
  it("SUBMITTED -> UNDER_REVIEW -> APPROVED|REJECTED only; every other move is refused by the functions", async () => {
    const a = await submitApplication();
    expect(await code(as(w.pa, (t) => sql`SELECT platform.approve_application(${a.id}::uuid)`.execute(t)))).toBe("22023");   // skip review
    expect(await code(as(w.pa, (t) => sql`SELECT platform.reject_application(${a.id}::uuid, 'valid reason here')`.execute(t)))).toBe("22023");
    await as(w.pa, (t) => sql`SELECT platform.start_review(${a.id}::uuid)`.execute(t));
    expect(await code(as(w.pa, (t) => sql`SELECT platform.start_review(${a.id}::uuid)`.execute(t)))).toBe("22023");           // twice
    await as(w.pa, (t) => sql`SELECT platform.approve_application(${a.id}::uuid)`.execute(t));
    expect(await code(as(w.pa, (t) => sql`SELECT platform.approve_application(${a.id}::uuid)`.execute(t)))).toBe("22023");
    expect(await code(as(w.pa, (t) => sql`SELECT platform.reject_application(${a.id}::uuid, 'changed my mind')`.execute(t)))).toBe("22023");
  });

  it("a rejection needs a real reason", async () => {
    const a = await reviewed();
    for (const reason of ["", "   ", "no", "x".repeat(1001)]) {
      expect(await code(as(w.pa, (t) => sql`SELECT platform.reject_application(${a.id}::uuid, ${reason})`.execute(t))), JSON.stringify(reason.slice(0, 5))).toBe("22023");
    }
    expect((await rowOf(a.id)).status).toBe("UNDER_REVIEW");
  });

  it("unknown application ids are refused", async () => {
    expect(await code(as(w.pa, (t) => sql`SELECT platform.start_review(gen_random_uuid())`.execute(t)))).toBe("22023");
  });

  it("the database itself blocks illegal transitions and edits even when the functions are bypassed", async () => {
    const a = await submitApplication();
    await expect(adminWrite("UPDATE college_applications SET status = 'APPROVED' WHERE id = $1", [a.id])).rejects.toMatchObject({ code: DENIED });
    const b = await reviewed();
    await as(w.pa, (t) => sql`SELECT platform.reject_application(${b.id}::uuid, 'Does not meet the criteria')`.execute(t));
    await expect(adminWrite("UPDATE college_applications SET status = 'UNDER_REVIEW' WHERE id = $1", [b.id])).rejects.toMatchObject({ code: DENIED }); // terminal
    const c = await submitApplication();
    await expect(adminWrite("UPDATE college_applications SET name = 'Renamed after the fact' WHERE id = $1", [c.id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("UPDATE college_applications SET official_email = 'someone.else@example.test' WHERE id = $1", [c.id])).rejects.toMatchObject({ code: DENIED });
    expect(await inspect("SELECT 1 FROM pg_trigger WHERE tgrelid = 'college_applications'::regclass AND tgname = 'college_applications_guard'")).toHaveLength(1);
  });

  it("table CHECKs: rejected needs a reason, approved needs a college", async () => {
    const a = await reviewed();
    await expect(adminWrite("UPDATE college_applications SET status = 'REJECTED', decided_at = now() WHERE id = $1", [a.id])).rejects.toMatchObject({ code: "23514" });
    await expect(adminWrite("UPDATE college_applications SET status = 'APPROVED', decided_at = now() WHERE id = $1", [a.id])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("authorisation of platform actions", () => {
  it("every non-platform caller is refused, for every action", async () => {
    const sub = await submitApplication();
    const rev = await reviewed();
    const college = w.A.collegeId;
    const inq = (await sql<{ id: string }>`SELECT platform.submit_inquiry('Asker', 'asker@example.test', null, 'Please tell me about pricing') AS id`.execute(db())).rows[0].id;
    const actions: [string, ReturnType<typeof sql>][] = [
      ["start_review", sql`SELECT platform.start_review(${sub.id}::uuid)`],
      ["approve", sql`SELECT platform.approve_application(${rev.id}::uuid)`],
      ["reject", sql`SELECT platform.reject_application(${rev.id}::uuid, 'a perfectly good reason')`],
      ["commercial", sql`SELECT platform.set_commercial_status(${college}::uuid, 'ACTIVE', 'x')`],
      ["suspend", sql`SELECT platform.set_college_access(${college}::uuid, 'SUSPENDED', 'a perfectly good reason')`],
      ["inquiry", sql`SELECT platform.handle_inquiry(${inq}::uuid)`],
      ["internal notes", sql`SELECT * FROM platform.college_internal(${college}::uuid)`],
    ];
    for (const who of [null, w.A.student, w.A.officer, w.A.coordinator, w.A.admin, w.B.admin]) {
      for (const [name, q] of actions) expect(await code(call(who, q)), `${who?.role ?? "anonymous"} -> ${name}`).toBe(DENIED);
    }
    expect((await rowOf(sub.id)).status).toBe("SUBMITTED");
    expect((await rowOf(rev.id)).status).toBe("UNDER_REVIEW");
    expect((await inspect<{ status: string }>("SELECT status FROM colleges WHERE id = $1", [college]))[0].status).toBe("ACTIVE");
  });

  it("a platform admin cannot decide an application filed under their own email (conflict of interest)", async () => {
    const pa = await platformAdmin();
    const a = await reviewed({ email: pa.email });
    expect(await code(as(w.pa, (t) => sql`SELECT platform.approve_application(${a.id}::uuid)`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.pa, (t) => sql`SELECT platform.reject_application(${a.id}::uuid, 'conflicted decision')`.execute(t)))).toBe(DENIED);
    expect((await rowOf(a.id)).status).toBe("UNDER_REVIEW");
  });
});

describe("approval creates the college workspace", () => {
  it("copies the applicant's details, links both ways, and is audited", async () => {
    const a = await reviewed({ name: uniq("Approval College"), state: "Kerala", students: 2500, type: "GOVERNMENT_AIDED" });
    const id = (await as(w.pa, (t) => sql<{ id: string }>`SELECT platform.approve_application(${a.id}::uuid) AS id`.execute(t))).rows[0].id;
    const [c] = await inspect<Record<string, unknown>>("SELECT * FROM colleges WHERE id = $1", [id]);
    expect(c).toMatchObject({ application_id: a.id, status: "ACTIVE", commercial_status: "NOT_STARTED", state: "Kerala", approx_students: 2500, college_type: "GOVERNMENT_AIDED", official_email: a.email });
    expect(await rowOf(a.id)).toMatchObject({ status: "APPROVED", college_id: id });
    const audit = await inspect<{ action: string; actor_user_id: string; scope: string }>("SELECT action, actor_user_id, scope FROM audit_log WHERE entity_id = $1 ORDER BY id", [a.id]);
    expect(audit.map((r) => r.action)).toEqual(["APPLICATION_SUBMITTED", "APPLICATION_REVIEW_STARTED", "APPLICATION_APPROVED"]);
    expect(audit[2]).toMatchObject({ actor_user_id: w.pa.userId, scope: "PLATFORM" });
    expect(audit[0].actor_user_id).toBeNull(); // anonymous submission
  });

  it("approval + admin invitation are one transaction: if the invitation fails nothing is approved", async () => {
    const a = await reviewed();
    const clash = w.A.student.email; // already an account -> invitation refuses
    await expect(as(w.pa, async (t) => {
      const c = await sql<{ id: string }>`SELECT platform.approve_application(${a.id}::uuid) AS id`.execute(t);
      await sql`SELECT auth.create_invitation(${clash}, 'COLLEGE_ADMIN', ${c.rows[0].id}::uuid, ${hashToken(newToken())}, 3600)`.execute(t);
    })).rejects.toMatchObject({ code: "23505" });
    expect(await rowOf(a.id)).toMatchObject({ status: "UNDER_REVIEW", college_id: null });
    expect(await inspect("SELECT 1 FROM colleges WHERE application_id = $1", [a.id])).toHaveLength(0);
  });

  it("the invited college admin becomes admin of exactly that college", async () => {
    const a = await reviewed();
    const token = newToken();
    const cid = await as(w.pa, async (t) => {
      const c = await sql<{ id: string }>`SELECT platform.approve_application(${a.id}::uuid) AS id`.execute(t);
      await sql`SELECT auth.create_invitation(${a.email}, 'COLLEGE_ADMIN', ${c.rows[0].id}::uuid, ${hashToken(token)}, 3600)`.execute(t);
      return c.rows[0].id;
    });
    const r = await sql<{ role: string; college_id: string }>`SELECT * FROM auth.accept_invitation(${hashToken(token)}, 'New Admin', ${FAKE_HASH})`.execute(db());
    expect(r.rows[0]).toEqual({ user_id: expect.any(String), role: "COLLEGE_ADMIN", college_id: cid });
  });

  it("parallel approvals of one application create exactly one college", async () => {
    const a = await reviewed();
    const results = await Promise.all(Array.from({ length: 6 }, () => code(as(w.pa, (t) => sql`SELECT platform.approve_application(${a.id}::uuid)`.execute(t)))));
    expect(results.filter((r) => r === "OK")).toHaveLength(1);
    expect(await inspect("SELECT 1 FROM colleges WHERE application_id = $1", [a.id])).toHaveLength(1);
  });

  it("colleges cannot be created any other way", async () => {
    expect(await code(as(w.pa, (t) => sql`INSERT INTO colleges (name) VALUES ('Back Door College')`.execute(t)))).toBe(DENIED);
    expect(await code(adminWrite("INSERT INTO colleges (name, application_id) VALUES ('X Y', gen_random_uuid())"))).toBe("23503"); // FK to a real application
  });
});

describe("college access (suspension) and commercial status", () => {
  it("commercial status is a manual record: valid values only, history in the audit log, and it does NOT block access", async () => {
    const cid = await createCollege();
    const admin = await createUser(w.pa, "COLLEGE_ADMIN", cid, "comm");
    expect((await inspect<{ commercial_status: string }>("SELECT commercial_status FROM colleges WHERE id = $1", [cid]))[0].commercial_status).toBe("NOT_STARTED");
    for (const s of ["PENDING", "ACTIVE", "EXPIRED", "SUSPENDED"]) await as(w.pa, (t) => sql`SELECT platform.set_commercial_status(${cid}::uuid, ${s}, ${"note " + s})`.execute(t));
    expect(await code(as(w.pa, (t) => sql`SELECT platform.set_commercial_status(${cid}::uuid, 'PAID', null)`.execute(t)))).toBe("22023");
    expect(await code(as(w.pa, (t) => sql`SELECT platform.set_commercial_status(gen_random_uuid(), 'ACTIVE', null)`.execute(t)))).toBe("22023");
    const changes = await inspect<{ metadata: { from: string; to: string } }>("SELECT metadata FROM audit_log WHERE action = 'COMMERCIAL_STATUS_CHANGED' AND entity_id = $1 ORDER BY id", [cid]);
    expect(changes.map((c) => `${c.metadata.from}>${c.metadata.to}`)).toEqual(["NOT_STARTED>PENDING", "PENDING>ACTIVE", "ACTIVE>EXPIRED", "EXPIRED>SUSPENDED"]);
    await expect(as(admin, async () => "still has access")).resolves.toBe("still has access"); // policy: commercial status alone does not gate access
  });

  it("internal notes are invisible to the college and readable only through the platform function", async () => {
    await as(w.pa, (t) => sql`SELECT platform.set_commercial_status(${w.A.collegeId}::uuid, 'PENDING', 'invoice #42 sent')`.execute(t));
    expect(await code(as(w.A.admin, (t) => sql`SELECT commercial_note FROM colleges`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.A.admin, (t) => sql`SELECT suspended_reason FROM colleges`.execute(t)))).toBe(DENIED);
    expect(await code(as(w.pa, (t) => sql`SELECT commercial_note FROM colleges`.execute(t)))).toBe(DENIED); // even platform: via function only
    const r = await as(w.pa, (t) => sql<{ commercial_note: string }>`SELECT * FROM platform.college_internal(${w.A.collegeId}::uuid)`.execute(t));
    expect(r.rows[0].commercial_note).toBe("invoice #42 sent");
  });

  it("a tenant can read its own college profile but not another college's", async () => {
    const rows = (await as(w.A.admin, (t) => sql<{ id: string; state: string }>`SELECT id, state, official_email FROM colleges`.execute(t))).rows;
    expect(rows.map((r) => r.id)).toEqual([w.A.collegeId]);
  });

  it("suspension needs a reason, cuts off every user of the college at once, and reactivation restores access", async () => {
    const cid = await createCollege();
    const admin = await createUser(w.pa, "COLLEGE_ADMIN", cid, "susp");
    const stu = await createUser(admin, "STUDENT", cid, "susp-stu");
    const tok = newToken();
    await sql`SELECT auth.create_session(${stu.userId}::uuid, ${hashToken(tok)}, 1800, 43200, null, null)`.execute(db());
    const live = async () => (await sql`SELECT * FROM auth.resolve_session(${hashToken(tok)})`.execute(db())).rows.length;
    expect(await live()).toBe(1);

    for (const reason of [null, "", "no"]) expect(await code(as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'SUSPENDED', ${reason})`.execute(t)))).toBe("22023");
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'SUSPENDED', 'Contract dispute pending')`.execute(t));
    expect(await live()).toBe(0);
    await expect(as(admin, async () => 1)).rejects.toThrow(/does not match/);
    expect((await sql<{ college_active: boolean }>`SELECT * FROM auth.get_login_user(${stu.email})`.execute(db())).rows[0].college_active).toBe(false);
    expect(await code(as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'SUSPENDED', 'again for no reason')`.execute(t)))).toBe("22023"); // already suspended
    expect((await as(w.pa, (t) => sql<{ suspended_reason: string }>`SELECT * FROM platform.college_internal(${cid}::uuid)`.execute(t))).rows[0].suspended_reason).toBe("Contract dispute pending");

    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'ACTIVE', null)`.execute(t));
    expect(await live()).toBe(1);
    await expect(as(admin, async () => "ok")).resolves.toBe("ok");
    const acts = (await inspect<{ action: string }>("SELECT action FROM audit_log WHERE entity_id = $1 AND action LIKE 'COLLEGE_%' ORDER BY id", [cid])).map((r) => r.action);
    expect(acts).toEqual(["COLLEGE_SUSPENDED", "COLLEGE_REACTIVATED"]);
  });

  it("the table itself refuses a suspended college without a reason", async () => {
    await expect(adminWrite("UPDATE colleges SET status = 'SUSPENDED' WHERE id = $1", [w.B.collegeId])).rejects.toMatchObject({ code: "23514" });
  });
});

describe("contact inquiries", () => {
  it("anyone can submit; only the platform can read; handling is once-only and audited", async () => {
    const mk = () => sql<{ id: string }>`SELECT platform.submit_inquiry('Visitor', 'visitor@example.test', 'Some College', 'Do you support diploma students?') AS id`.execute(db());
    const id = (await mk()).rows[0].id;
    const n = async (a: Actor) => (await as(a, (t) => sql<{ n: number }>`SELECT count(*)::int AS n FROM contact_inquiries`.execute(t))).rows[0].n;
    expect(await n(w.pa)).toBeGreaterThan(0);
    for (const a of [w.A.admin, w.A.officer, w.A.coordinator, w.A.student]) expect(await n(a)).toBe(0);
    await as(w.pa, (t) => sql`SELECT platform.handle_inquiry(${id}::uuid)`.execute(t));
    expect(await code(as(w.pa, (t) => sql`SELECT platform.handle_inquiry(${id}::uuid)`.execute(t)))).toBe("22023");
    expect(await inspect("SELECT 1 FROM audit_log WHERE action = 'INQUIRY_HANDLED' AND entity_id = $1", [id])).toHaveLength(1);
  });
  it("validates input at the database", async () => {
    expect(await code(sql`SELECT platform.submit_inquiry('V', 'v@example.test', null, 'long enough message here')`.execute(db()))).toBe("23514");
    expect(await code(sql`SELECT platform.submit_inquiry('Visitor', 'v@example.test', null, 'short')`.execute(db()))).toBe("23514");
    expect(await code(sql`SELECT platform.submit_inquiry('Visitor', 'bad-email', null, 'long enough message here')`.execute(db()))).toBe("23514");
    expect(await code(sql`SELECT platform.submit_inquiry('Visitor', 'v@example.test', null, ${"m".repeat(2001)})`.execute(db()))).toBe("23514");
  });
});

describe("platform audit log", () => {
  it("contains the onboarding trail and is readable only by the platform admin", async () => {
    const seen = async (a: Actor) => (await as(a, (t) => sql<{ action: string }>`SELECT DISTINCT action FROM audit_log`.execute(t))).rows.map((r) => r.action);
    expect(await seen(w.pa)).toEqual(expect.arrayContaining(["APPLICATION_SUBMITTED", "APPLICATION_APPROVED", "APPLICATION_REJECTED", "COLLEGE_SUSPENDED", "COMMERCIAL_STATUS_CHANGED"]));
    expect(await seen(w.A.admin)).not.toContain("APPLICATION_APPROVED");
    expect(await seen(w.A.student)).toEqual([]);
  });
});

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, createCollege, createUser, DENIED, inspect, seedTwoColleges, uniq, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));

type C = { name: string; website: string | null; industry: string | null; description: string | null; person: string | null; email: string | null; phone: string | null; location: string | null };
const co = (o: Partial<C> = {}): C => ({ name: uniq("Acme Corp"), website: "https://acme.example.test", industry: "Software", description: "Builds things", person: "Ravi Recruiter", email: "Ravi@Acme.Example.Test", phone: "+91 98765 43210", location: "Bengaluru", ...o });
const create = (a: Actor | null, o: Partial<C> = {}) => { const c = co(o); return call(a, sql`SELECT placement.create_company(${c.name}, ${c.website}, ${c.industry}, ${c.description}, ${c.person}, ${c.email}, ${c.phone}, ${c.location}) AS id`); };
const mk = async (a: Actor, o: Partial<C> = {}) => ((await create(a, o)).rows[0] as { id: string }).id;
const update = (a: Actor | null, id: string, o: Partial<C> = {}) => { const c = co(o); return call(a, sql`SELECT placement.update_company(${id}::uuid, ${c.name}, ${c.website}, ${c.industry}, ${c.description}, ${c.person}, ${c.email}, ${c.phone}, ${c.location})`); };
const setStatus = (a: Actor | null, id: string, s: string) => call(a, sql`SELECT placement.set_company_status(${id}::uuid, ${s})`);
const visible = async (a: Actor) => (await as(a, (t) => sql<{ id: string }>`SELECT id FROM companies`.execute(t))).rows.map((r) => r.id).sort();
const events = async (id: string) => (await inspect<{ event: string; actor_name: string; detail: string | null }>("SELECT event, actor_name, detail FROM company_events WHERE company_id = $1 ORDER BY id", [id]));

beforeAll(async () => { w = await seedTwoColleges(); });
afterAll(async () => { await closeAppDb(); });

describe("who can write companies", () => {
  it("only a placement officer may use any company function (every other caller refused)", async () => {
    const id = await mk(w.A.officer);
    for (const who of [null, w.A.admin, w.A.coordinator, w.A.student, w.pa]) {
      expect(await code(create(who)), `create as ${who?.role ?? "anonymous"}`).toBe(DENIED);
      expect(await code(update(who, id)), `update as ${who?.role ?? "anonymous"}`).toBe(DENIED);
      expect(await code(setStatus(who, id, "INACTIVE")), `status as ${who?.role ?? "anonymous"}`).toBe(DENIED);
    }
  });
  it("the runtime role cannot INSERT, UPDATE or DELETE companies directly, even as an officer", async () => {
    const id = await mk(w.A.officer);
    for (const q of [sql`INSERT INTO companies (college_id, name, created_by) VALUES (${w.A.collegeId}, 'Sneaky Co', ${w.A.officer.userId})`, sql`UPDATE companies SET name = 'Hacked' WHERE id = ${id}`, sql`UPDATE companies SET status = 'INACTIVE' WHERE id = ${id}`, sql`DELETE FROM companies WHERE id = ${id}`]) {
      expect(await code(as(w.A.officer, (t) => q.execute(t)))).toBe(DENIED);
    }
    expect(await code(as(w.A.officer, (t) => sql`DELETE FROM company_events`.execute(t)))).toBe(DENIED);
  });
  it("an officer cannot touch another college's company", async () => {
    const idB = await mk(w.B.officer);
    expect(await code(update(w.A.officer, idB))).toBe("22023");
    expect(await code(setStatus(w.A.officer, idB, "INACTIVE"))).toBe("22023");
    expect((await inspect<{ status: string }>("SELECT status FROM companies WHERE id = $1", [idB]))[0].status).toBe("ACTIVE");
  });
});

describe("company data rules", () => {
  it("stores trimmed values, lower-cases the contact email, and turns blank optionals into NULL", async () => {
    const id = await mk(w.A.officer, { name: "  " + uniq("Trim Co") + "  ", email: "  Hr@Trim.Example.Test ", website: "   ", industry: "", description: "  ", person: " ", phone: "", location: "  " });
    const [r] = await inspect<Record<string, unknown>>("SELECT name::text AS name, contact_email::text AS email, website, industry, description, contact_person, contact_phone, location FROM companies WHERE id = $1", [id]);
    expect((r.name as string)).toBe((r.name as string).trim());
    expect(r).toMatchObject({ email: "hr@trim.example.test", website: null, industry: null, description: null, contact_person: null, contact_phone: null, location: null });
  });
  it("names are unique per college (case-insensitive) but reusable across colleges", async () => {
    const name = uniq("Globex");
    await mk(w.A.officer, { name });
    expect(await code(create(w.A.officer, { name: name.toUpperCase() }))).toBe("23505");
    expect(await code(create(w.B.officer, { name }))).toBe("OK");
    await expect(create(w.A.officer, { name })).rejects.toThrow(/already exists/);
  });
  const bad: [string, Partial<C>][] = [
    ["one-letter name", { name: "X" }], ["over-long name", { name: "N".repeat(151) }], ["javascript: website", { website: "javascript:alert(1)" }], ["data: website", { website: "data:text/html,x" }],
    ["website with spaces", { website: "https://a.test/ x" }], ["ftp website", { website: "ftp://x.test" }], ["email without @", { email: "nope" }], ["email with spaces", { email: "a b@c.test" }],
    ["letters in phone", { phone: "call me" }], ["one-letter location", { location: "X" }], ["over-long description", { description: "d".repeat(2001) }], ["one-letter contact person", { person: "R" }],
  ];
  for (const [label, o] of bad) it(`rejects ${label}`, async () => { expect(await code(create(w.A.officer, o)), label).toBe("22023"); });

  it("update changes the company, records exactly which fields changed (never their values), and audits it; a no-op update records nothing", async () => {
    const c = co();
    const id = await mk(w.A.officer, c);
    await call(w.A.officer, sql`SELECT placement.update_company(${id}::uuid, ${c.name}, ${c.website}, ${c.industry}, ${c.description}, ${c.person}, ${c.email}, ${c.phone}, ${c.location})`);   // identical
    expect((await events(id)).map((e) => e.event)).toEqual(["CREATED"]);
    await update(w.A.officer, id, { ...c, location: "Pune", phone: "+91 90000 00000" });
    const ev = await events(id);
    expect(ev.map((e) => e.event)).toEqual(["CREATED", "UPDATED"]);
    expect(ev[1].detail).toBe("Changed: contact phone, location");
    expect(ev[1].detail).not.toMatch(/Pune|90000/);
    expect(ev[1].actor_name).toMatch(/officerA/);
    expect(await inspect("SELECT 1 FROM audit_log WHERE action = 'COMPANY_UPDATED' AND entity_id = $1", [id])).toHaveLength(1);
  });
  it("update refuses a name that collides with another company in the college", async () => {
    const a = await mk(w.A.officer); const b = await mk(w.A.officer);
    const [other] = await inspect<{ name: string }>("SELECT name::text AS name FROM companies WHERE id = $1", [a]);
    expect(await code(update(w.A.officer, b, { name: other.name.toLowerCase() }))).toBe("23505");
  });
  it("deactivate and reactivate are tracked; repeating or an invalid status is refused; companies are never deleted", async () => {
    const id = await mk(w.A.officer);
    await setStatus(w.A.officer, id, "INACTIVE");
    expect(await code(setStatus(w.A.officer, id, "INACTIVE"))).toBe("22023");
    expect(await code(setStatus(w.A.officer, id, "DELETED"))).toBe("22023");
    await setStatus(w.A.officer, id, "ACTIVE");
    expect((await events(id)).map((e) => e.event)).toEqual(["CREATED", "DEACTIVATED", "REACTIVATED"]);
    await expect(adminWrite("DELETE FROM companies WHERE id = $1", [id])).rejects.toMatchObject({ code: DENIED });
  });
});

describe("who can read companies (row level security)", () => {
  it("officers and admins see their own college's companies and no other college's", async () => {
    const a = await mk(w.A.officer); const b = await mk(w.B.officer);
    for (const who of [w.A.officer, w.A.admin]) { const seen = await visible(who); expect(seen).toContain(a); expect(seen).not.toContain(b); }
    for (const who of [w.B.officer, w.B.admin]) { const seen = await visible(who); expect(seen).toContain(b); expect(seen).not.toContain(a); }
  });
  it("coordinators, students, the platform and no-context see none", async () => {
    await mk(w.A.officer);
    for (const who of [w.A.coordinator, w.A.student, w.pa, w.B.coordinator]) expect(await visible(who), who.role).toEqual([]);
    expect((await sql`SELECT 1 FROM companies`.execute(db())).rows).toEqual([]);
    expect((await sql`SELECT 1 FROM company_events`.execute(db())).rows).toEqual([]);
  });
  it("company history is visible to officers and admins of that college only", async () => {
    const id = await mk(w.A.officer); await update(w.A.officer, id, { location: "Chennai" });
    const evFor = async (who: Actor) => (await as(who, (t) => sql`SELECT 1 FROM company_events WHERE company_id = ${id}`.execute(t))).rows.length;
    expect(await evFor(w.A.officer)).toBe(2);
    expect(await evFor(w.A.admin)).toBe(2);
    for (const who of [w.B.officer, w.B.admin, w.A.coordinator, w.A.student, w.pa]) expect(await evFor(who), who.role).toBe(0);
  });
});

describe("the database itself protects the record", () => {
  it("ownership and creation details are immutable; history is append-only", async () => {
    const id = await mk(w.A.officer);
    await expect(adminWrite("UPDATE companies SET college_id = $2 WHERE id = $1", [id, w.B.collegeId])).rejects.toMatchObject({ code: expect.stringMatching(/^(42501|23503)$/) });
    await expect(adminWrite("UPDATE companies SET created_by = $2 WHERE id = $1", [id, w.A.admin.userId])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("UPDATE company_events SET event = 'DEACTIVATED' WHERE company_id = $1", [id])).rejects.toMatchObject({ code: DENIED });
    await expect(adminWrite("DELETE FROM company_events WHERE company_id = $1", [id])).rejects.toMatchObject({ code: DENIED });
    expect(await inspect("SELECT 1 FROM pg_trigger WHERE tgrelid = 'company_events'::regclass AND NOT tgisinternal")).toHaveLength(2);
  });
  it("an event cannot point at another college's company", async () => {
    const id = await mk(w.A.officer);
    await expect(adminWrite("INSERT INTO company_events (college_id, company_id, event, actor_user_id, actor_name) VALUES ($1, $2, 'UPDATED', $3, 'x')", [w.B.collegeId, id, w.A.officer.userId])).rejects.toMatchObject({ code: "23503" });
  });
  it("parallel creates of the same name produce exactly one company", async () => {
    const name = uniq("Race Co");
    const res = await Promise.all(Array.from({ length: 6 }, () => code(create(w.A.officer, { name }))));
    expect(res.filter((r) => r === "OK")).toHaveLength(1);
    expect(res.filter((r) => r === "23505")).toHaveLength(5);
  });
});

describe("suspended college", () => {
  it("loses all company authority and regains it on reactivation", async () => {
    const cid = await createCollege();
    const admin = await createUser(w.pa, "COLLEGE_ADMIN", cid, "scomp");
    const officer = await createUser(admin, "PLACEMENT_OFFICER", cid, "scomp-o");
    const id = await mk(officer);
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'SUSPENDED', 'suspended for the test')`.execute(t));
    expect(await code(sql`SELECT placement.create_company('After Suspend Co', null, null, null, null, null, null, null)`.execute(db()))).toBe(DENIED);
    await as(w.pa, (t) => sql`SELECT platform.set_college_access(${cid}::uuid, 'ACTIVE', null)`.execute(t));
    expect(await visible(officer)).toContain(id);
  });
});

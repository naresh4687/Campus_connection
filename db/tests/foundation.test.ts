import { sql } from "kysely";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../migrator";
import { ContextMismatchError } from "../../src/server/db/context";
import { createDb, withTenantTx } from "../../src/server/db";
import { appUrl, withOwner } from "./helpers";
import { closeAppDb, inspect, seedTwoColleges } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World;
const appDb = createDb(appUrl(), 1); // pool of ONE connection: proves no context leaks between transactions

beforeAll(async () => {
  w = await seedTwoColleges();
  // Test-only fixture table, owned by cc_owner, with RLS forced exactly like real tenant tables will be.
  await withOwner(async (c) => {
    await c.query(`
      CREATE TABLE rls_probe (id serial PRIMARY KEY, college_id uuid NOT NULL, note text NOT NULL);
      INSERT INTO rls_probe (college_id, note) VALUES ('${w.A.collegeId}', 'a-secret'), ('${w.B.collegeId}', 'b-secret');
      ALTER TABLE rls_probe ENABLE ROW LEVEL SECURITY;
      ALTER TABLE rls_probe FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_isolation ON rls_probe
        USING (college_id = (SELECT app.current_college_id()))
        WITH CHECK (college_id = (SELECT app.current_college_id()));
      GRANT SELECT, INSERT, UPDATE, DELETE ON rls_probe TO cc_app;
      GRANT SELECT ON rls_probe TO cc_auth;
      GRANT USAGE ON SEQUENCE rls_probe_id_seq TO cc_app;
    `);
  });
});

afterAll(async () => {
  await appDb.destroy();
  await withOwner((c) => c.query("DROP TABLE IF EXISTS rls_probe").then(() => undefined));
  await closeAppDb();
});

describe("migrations", () => {
  it("are idempotent: a second run applies nothing", async () => {
    const r = await migrate(process.env.TEST_MIGRATE_DATABASE_URL!);
    expect(r.applied).toEqual([]);
    expect(r.alreadyApplied).toEqual(expect.arrayContaining(["0001_baseline.sql", "0002_identity.sql"]));
  });

  it("refuse to run if an applied file was altered", async () => {
    const { mkdtempSync, writeFileSync, readFileSync, readdirSync } = await import("node:fs");
    const os = await import("node:os");
    const path = await import("node:path");
    const dir = mkdtempSync(path.join(os.tmpdir(), "mig-"));
    for (const f of readdirSync("db/migrations")) writeFileSync(path.join(dir, f), readFileSync(`db/migrations/${f}`, "utf8"));
    writeFileSync(path.join(dir, "0001_baseline.sql"), readFileSync("db/migrations/0001_baseline.sql", "utf8") + "\n-- tampered\n");
    await expect(migrate(process.env.TEST_MIGRATE_DATABASE_URL!, dir)).rejects.toThrow(/modified after being applied/);
    // and a removed file is also refused
    writeFileSync(path.join(dir, "0001_baseline.sql"), readFileSync("db/migrations/0001_baseline.sql", "utf8"));
    const { rmSync } = await import("node:fs");
    rmSync(path.join(dir, "0002_identity.sql"));
    await expect(migrate(process.env.TEST_MIGRATE_DATABASE_URL!, dir)).rejects.toThrow(/is missing from/);
  });
});

describe("runtime role privileges (cc_app)", () => {
  it("is not superuser and cannot bypass RLS", async () => {
    const { rows } = await appDb.executeQuery<{ rolsuper: boolean; rolbypassrls: boolean; rolcreaterole: boolean; rolcreatedb: boolean }>(
      sql`SELECT rolsuper, rolbypassrls, rolcreaterole, rolcreatedb FROM pg_roles WHERE rolname = current_user`.compile(appDb),
    );
    expect(rows[0]).toEqual({ rolsuper: false, rolbypassrls: false, rolcreaterole: false, rolcreatedb: false });
  });

  it("cannot create tables or alter the schema", async () => {
    await expect(sql`CREATE TABLE public.evil (id int)`.execute(appDb)).rejects.toThrow(/permission denied/);
    await expect(sql`CREATE SCHEMA evil`.execute(appDb)).rejects.toThrow(/permission denied/);
  });

  it("cannot disable RLS or drop policies on a table it does not own", async () => {
    await expect(sql`ALTER TABLE rls_probe DISABLE ROW LEVEL SECURITY`.execute(appDb)).rejects.toThrow(/must be owner/);
    await expect(sql`DROP POLICY tenant_isolation ON rls_probe`.execute(appDb)).rejects.toThrow(/must be owner/);
  });

  it("cannot read the migration ledger", async () => {
    await expect(sql`SELECT * FROM schema_migrations`.execute(appDb)).rejects.toThrow(/permission denied/);
  });

  it("cannot SET ROLE to the privileged definer role", async () => {
    await expect(sql`SET ROLE cc_auth`.execute(appDb)).rejects.toThrow(/permission denied|must be member/);
  });
});

describe("tenant context + RLS (fail closed)", () => {
  it("returns NO rows when no context is set", async () => {
    expect((await sql`SELECT note FROM rls_probe`.execute(appDb)).rows).toEqual([]);
  });

  it("each college sees only its own rows", async () => {
    const a = await withTenantTx(w.A.admin, (t) => sql<{ note: string }>`SELECT note FROM rls_probe`.execute(t), appDb);
    expect(a.rows).toEqual([{ note: "a-secret" }]);
    const b = await withTenantTx(w.B.student, (t) => sql<{ note: string }>`SELECT note FROM rls_probe`.execute(t), appDb);
    expect(b.rows).toEqual([{ note: "b-secret" }]);
  });

  it("a platform admin is not a tenant: it sees no tenant rows through tenant policies", async () => {
    const r = await withTenantTx(w.pa, (t) => sql`SELECT note FROM rls_probe`.execute(t), appDb);
    expect(r.rows).toEqual([]);
  });

  it("blocks inserting a row into another college (WITH CHECK)", async () => {
    await expect(
      withTenantTx(w.A.admin, (t) => sql`INSERT INTO rls_probe (college_id, note) VALUES (${w.B.collegeId}, 'injected')`.execute(t), appDb),
    ).rejects.toThrow(/row-level security/);
  });

  it("cannot update or delete another college's rows (matches nothing)", async () => {
    const upd = await withTenantTx(w.A.admin, (t) => sql`UPDATE rls_probe SET note = 'x' WHERE college_id = ${w.B.collegeId}`.execute(t), appDb);
    expect(Number(upd.numAffectedRows)).toBe(0);
    const del = await withTenantTx(w.A.admin, (t) => sql`DELETE FROM rls_probe WHERE college_id = ${w.B.collegeId}`.execute(t), appDb);
    expect(Number(del.numAffectedRows)).toBe(0);
    expect(await inspect("SELECT note FROM rls_probe WHERE college_id = $1", [w.B.collegeId])).toEqual([{ note: "b-secret" }]);
  });

  it("does not leak context to the next use of the same pooled connection", async () => {
    await withTenantTx(w.A.admin, (t) => sql`SELECT 1`.execute(t), appDb);
    expect((await sql`SELECT note FROM rls_probe`.execute(appDb)).rows).toEqual([]);
    const ctx = await sql<{ c: string | null; r: string | null }>`SELECT app.current_college_id()::text AS c, app.current_role() AS r`.execute(appDb);
    expect(ctx.rows[0]).toEqual({ c: null, r: null });
  });

  it("rolls back when the callback throws", async () => {
    await expect(
      withTenantTx(w.A.admin, async (t) => {
        await sql`INSERT INTO rls_probe (college_id, note) VALUES (${w.A.collegeId}, 'temp')`.execute(t);
        throw new Error("boom");
      }, appDb),
    ).rejects.toThrow("boom");
    expect(await inspect("SELECT count(*)::int AS n FROM rls_probe WHERE note = 'temp'")).toEqual([{ n: 0 }]);
    expect(await inspect("SELECT count(*)::int AS n FROM rls_probe WHERE note = 'a-secret'")).toEqual([{ n: 1 }]); // sanity: inspect() does see rows
  });

  it("rejects malformed context before touching the database", async () => {
    await expect(withTenantTx({ userId: "not-a-uuid", collegeId: w.A.collegeId, role: "COLLEGE_ADMIN" } as never, async () => 1, appDb)).rejects.toThrow();
    await expect(withTenantTx({ userId: w.A.admin.userId, collegeId: w.A.collegeId, role: "SUPERUSER" } as never, async () => 1, appDb)).rejects.toThrow();
  });

  it("rejects a context whose role or college disagrees with the database's own view", async () => {
    // A student pretending to be a platform admin / a college admin of the other college:
    await expect(withTenantTx({ ...w.A.student, role: "COLLEGE_ADMIN" }, async () => 1, appDb)).rejects.toBeInstanceOf(ContextMismatchError);
    await expect(withTenantTx({ ...w.A.admin, collegeId: w.B.collegeId }, async () => 1, appDb)).rejects.toBeInstanceOf(ContextMismatchError);
  });

  it("forging app.college_id / app.role directly has no effect (they are derived from users)", async () => {
    const r = await appDb.transaction().execute(async (t) => {
      await sql`SELECT set_config('app.user_id', ${w.A.student.userId}, true), set_config('app.college_id', ${w.B.collegeId}, true), set_config('app.role', 'PLATFORM_SUPER_ADMIN', true)`.execute(t);
      return sql<{ note: string }>`SELECT note FROM rls_probe`.execute(t);
    });
    expect(r.rows).toEqual([{ note: "a-secret" }]); // still college A, as the DB knows the student belongs to A
  });
});

describe("raw connection sanity", () => {
  it("app role connects to the test database", async () => {
    const c = new Client({ connectionString: appUrl() });
    await c.connect();
    const r = await c.query("SELECT current_database() AS db, current_user AS u");
    await c.end();
    expect(r.rows[0]).toEqual({ db: "campusconnect_test", u: "cc_app" });
  });
});

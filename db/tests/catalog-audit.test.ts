import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import { closeAppDb, inspect } from "./world";

// A standing audit of the real database catalog after all migrations: it fails when a future migration quietly widens what the runtime role can do.
const APP_SCHEMAS = ["app", "auth", "platform", "college", "students", "academics", "achievements", "documents", "placement", "eligibility", "registrations", "rounds", "offers", "reports", "notifications", "announcements"];
const SNAPSHOT = "db/tests/snapshots/cc_app-executable-functions.txt";
const list = (xs: unknown[]) => xs.map(String);
afterAll(async () => { await closeAppDb(); });

describe("roles", () => {
  it("the runtime role is powerless by itself; the definer role cannot log in; nobody keeps CREATE on any schema", async () => {
    const roles = await inspect<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean; rolcanlogin: boolean; rolcreatedb: boolean; rolcreaterole: boolean }>("SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname IN ('cc_app', 'cc_auth')");
    const by = Object.fromEntries(roles.map((r) => [r.rolname, r]));
    expect(by.cc_app).toMatchObject({ rolsuper: false, rolbypassrls: false, rolcreatedb: false, rolcreaterole: false, rolcanlogin: true });
    expect(by.cc_auth).toMatchObject({ rolsuper: false, rolbypassrls: true, rolcanlogin: false });          // powerful but reachable only through the vetted functions it owns
    for (const role of ["cc_app", "cc_auth"]) {
      const schemas = await inspect<{ nspname: string }>("SELECT nspname FROM pg_namespace WHERE has_schema_privilege($1, oid, 'CREATE') AND nspname NOT LIKE 'pg\\_%' AND nspname <> 'information_schema'", [role]);
      expect(list(schemas.map((s) => s.nspname)), `${role} can create objects in`).toEqual([]);
    }
  });
});

describe("tables", () => {
  it("the runtime role cannot insert, update, delete or truncate any table or column, in any schema", async () => {
    const t = await inspect<{ name: string }>(`SELECT n.nspname || '.' || c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind IN ('r', 'p') AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND (has_table_privilege('cc_app', c.oid, 'INSERT') OR has_table_privilege('cc_app', c.oid, 'UPDATE') OR has_table_privilege('cc_app', c.oid, 'DELETE')
        OR has_table_privilege('cc_app', c.oid, 'TRUNCATE') OR has_any_column_privilege('cc_app', c.oid, 'INSERT') OR has_any_column_privilege('cc_app', c.oid, 'UPDATE')) ORDER BY 1`);
    expect(list(t.map((x) => x.name))).toEqual([]);
  });
  it("every table has FORCED row-level security — or is invisible to the runtime role (internal tables reached only through definer functions)", async () => {
    const t = await inspect<{ name: string; forced: boolean; visible: boolean }>(`SELECT c.relname AS name, (c.relrowsecurity AND c.relforcerowsecurity) AS forced,
      (has_table_privilege('cc_app', c.oid, 'SELECT') OR has_any_column_privilege('cc_app', c.oid, 'SELECT')) AS visible
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') ORDER BY 1`);
    expect(list(t.filter((x) => !x.forced && x.visible).map((x) => x.name)), "readable without forced RLS").toEqual([]);
    expect(list(t.filter((x) => !x.forced).map((x) => x.name)), "the deliberate internal tables").toEqual(["password_resets", "rate_limits", "schema_migrations", "sessions"]);
  });
  it("views read with the caller's rights (security_invoker), so they cannot bypass row-level security", async () => {
    const v = await inspect<{ name: string; opts: string[] | null }>("SELECT c.relname AS name, c.reloptions AS opts FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('v', 'm') AND n.nspname NOT IN ('pg_catalog', 'information_schema')");
    for (const x of v) expect((x.opts ?? []).some((o) => /^security_invoker=(true|on)$/.test(o)), `view ${x.name}`).toBe(true);
  });
});

describe("functions", () => {
  it("every SECURITY DEFINER function is owned by the definer role and pins its search_path (no search-path hijacking)", async () => {
    const f = await inspect<{ name: string; owner: string; cfg: string[] | null }>(`SELECT n.nspname || '.' || p.proname AS name, pg_get_userbyid(p.proowner) AS owner, p.proconfig AS cfg
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.prosecdef AND n.nspname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1`);
    expect(f.length).toBeGreaterThan(100);
    expect(list(f.filter((x) => x.owner !== "cc_auth").map((x) => x.name)), "not owned by cc_auth").toEqual([]);
    expect(list(f.filter((x) => !(x.cfg ?? []).some((c) => /^search_path=pg_catalog/.test(c))).map((x) => x.name)), "search_path not pinned to pg_catalog first").toEqual([]);
  });
  it("no application function can be run by PUBLIC, except trigger functions (uncallable directly) and one pure helper", async () => {
    const f = await inspect<{ name: string }>(`SELECT n.nspname || '.' || p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = ANY ($1) AND has_function_privilege('public', p.oid, 'EXECUTE') AND p.prorettype <> 'trigger'::regtype ORDER BY 1`, [APP_SCHEMAS]);
    expect(list(f.map((x) => x.name))).toEqual(["eligibility.add_check"]);
    const d = await inspect<{ name: string }>(`SELECT n.nspname || '.' || p.proname AS name FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.prosecdef AND has_function_privilege('public', p.oid, 'EXECUTE') AND n.nspname = ANY ($1)`, [APP_SCHEMAS]);
    expect(list(d.map((x) => x.name)), "definer functions open to PUBLIC").toEqual([]);
  });
  it("the set of functions the runtime role may execute equals the reviewed snapshot (a new entry must be a deliberate, reviewed change)", async () => {
    const f = await inspect<{ sig: string }>(`SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = ANY ($1) AND has_function_privilege('cc_app', p.oid, 'EXECUTE') AND p.prorettype <> 'trigger'::regtype ORDER BY 1`, [APP_SCHEMAS]);
    const actual = list(f.map((x) => x.sig)).join("\n") + "\n";
    if (process.env.UPDATE_SNAPSHOT === "1" || !existsSync(SNAPSHOT)) { mkdirSync("db/tests/snapshots", { recursive: true }); writeFileSync(SNAPSHOT, actual); }
    expect(actual).toBe(readFileSync(SNAPSHOT, "utf8"));
  });
});

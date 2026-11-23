import "dotenv/config";
import { Client } from "pg";
import { migrate } from "../migrator";

/**
 * Runs once before the DB test project: rebuilds the *_test database from the migrations so every run
 * starts from an empty schema (and therefore also proves migrations work on a fresh database).
 * Guarded: refuses to touch anything that is not a *_test database.
 */
export default async function setup() {
  const url = process.env.TEST_MIGRATE_DATABASE_URL;
  if (!url || !/\/[A-Za-z0-9_]*_test(\?|$)/.test(url)) throw new Error("TEST_MIGRATE_DATABASE_URL must point at a *_test database");
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const { rows } = await c.query("SELECT current_database() AS db");
    if (!String(rows[0].db).endsWith("_test")) throw new Error(`refusing to reset ${rows[0].db}`);
    await c.query("DROP SCHEMA IF EXISTS push CASCADE; DROP SCHEMA IF EXISTS announcements CASCADE; DROP SCHEMA IF EXISTS achievements CASCADE; DROP SCHEMA IF EXISTS notifications CASCADE; DROP SCHEMA IF EXISTS reports CASCADE; DROP SCHEMA IF EXISTS offers CASCADE; DROP SCHEMA IF EXISTS rounds CASCADE; DROP SCHEMA IF EXISTS registrations CASCADE; DROP SCHEMA IF EXISTS eligibility CASCADE; DROP SCHEMA IF EXISTS placement CASCADE; DROP SCHEMA IF EXISTS documents CASCADE; DROP SCHEMA IF EXISTS academics CASCADE; DROP SCHEMA IF EXISTS students CASCADE; DROP SCHEMA IF EXISTS college CASCADE; DROP SCHEMA IF EXISTS platform CASCADE; DROP SCHEMA IF EXISTS auth CASCADE; DROP SCHEMA IF EXISTS app CASCADE; DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
    await c.query("GRANT USAGE ON SCHEMA public TO cc_app; GRANT USAGE ON SCHEMA public TO cc_auth;");
  } finally {
    await c.end();
  }
  await migrate(url);
}

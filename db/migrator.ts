import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";

export type MigrationResult = { applied: string[]; alreadyApplied: string[] };

const NAME_RE = /^\d{4}_[a-z0-9_]+\.sql$/;
const LOCK_KEY = 727_001; // arbitrary constant for pg_advisory_lock

/**
 * Forward-only SQL migration runner.
 *  - files: db/migrations/NNNN_name.sql, applied in lexical order, each in one transaction
 *  - records a SHA-256 checksum; editing an already-applied file is a hard error
 *  - advisory lock prevents two runners racing
 */
export async function migrate(
  connectionString: string,
  dir = path.join(process.cwd(), "db", "migrations"),
): Promise<MigrationResult> {
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (!NAME_RE.test(f)) throw new Error(`Bad migration file name: ${f}`);
  }

  const client = new Client({ connectionString });
  await client.connect();
  const result: MigrationResult = { applied: [], alreadyApplied: [] };
  try {
    await client.query("SELECT pg_advisory_lock($1)", [LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        name       text PRIMARY KEY,
        checksum   text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      "SELECT name, checksum FROM schema_migrations",
    );
    const done = new Map(rows.map((r) => [r.name, r.checksum]));

    for (const name of done.keys()) {
      if (!files.includes(name)) {
        throw new Error(`Applied migration ${name} is missing from ${dir}`);
      }
    }

    for (const name of files) {
      const sql = readFileSync(path.join(dir, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      const prior = done.get(name);
      if (prior !== undefined) {
        if (prior !== checksum) {
          throw new Error(`Migration ${name} was modified after being applied`);
        }
        result.alreadyApplied.push(name);
        continue;
      }
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query("INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)", [name, checksum]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`Migration ${name} failed: ${(err as Error).message}`);
      }
      result.applied.push(name);
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [LOCK_KEY]).catch(() => {});
    await client.end();
  }
  return result;
}

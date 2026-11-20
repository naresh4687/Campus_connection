import "dotenv/config";
import pg from "pg";
import { deleteObject } from "../src/server/storage/s3";

/**
 * Retention for external-registration screenshots: files of drives closed or archived more than N months ago (default 12) are deleted from
 * private storage and marked purged; the database row, the review history and the audit log stay. Dry run unless --apply.
 *   npx tsx scripts/purge-evidence.ts [--months 12] [--apply]
 */
const months = Number(process.argv[process.argv.indexOf("--months") + 1]) || 12;
const apply = process.argv.includes("--apply");
const url = process.env.MIGRATE_DATABASE_URL;
if (!url) { console.error("MIGRATE_DATABASE_URL is not set"); process.exit(1); }
const c = new pg.Client({ connectionString: url });
(async () => {
  await c.connect();
  const rows = (await c.query<{ id: string; storage_key: string }>("SELECT * FROM registrations.expired_evidence($1)", [months])).rows;
  console.log(`${rows.length} screenshot(s) older than ${months} months after the drive closed${apply ? "" : " (dry run; add --apply to delete)"}.`);
  if (!apply) return;
  for (const r of rows) { await deleteObject(r.storage_key); await c.query("SELECT registrations.mark_evidence_purged($1)", [r.id]); }
  console.log(`Purged ${rows.length}.`);
})().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => c.end());

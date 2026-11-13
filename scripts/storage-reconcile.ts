import "dotenv/config";
import { reconcile } from "../src/server/storage/reconcile";

// Usage: npm run storage:reconcile [-- --grace-minutes 60] [-- --delete-orphans --yes]
// Read-only by default. Never changes database rows; deletes only unreferenced objects that the application itself created and that are older than the grace period.
const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const grace = Number(args[args.indexOf("--grace-minutes") + 1]) || 60;
const del = flag("--delete-orphans");
if (del && !flag("--yes")) { console.error("Refusing to delete without --yes. Run without --delete-orphans first and read the report."); process.exit(2); }
const url = process.env.MIGRATE_DATABASE_URL;
if (!url) { console.error("MIGRATE_DATABASE_URL is not set"); process.exit(1); }

reconcile({ ownerUrl: url, graceMinutes: grace, deleteOrphans: del }).then((r) => {
  console.log(`objects matching a database record: ${r.ok}`);
  console.log(`orphaned objects (no record, older than ${grace} min): ${r.orphans.length}`); for (const o of r.orphans) console.log(`  ${o.key}  (${o.lastModified.toISOString()})`);
  console.log(`recent unreferenced objects (upload may be in flight; left alone): ${r.inFlight.length}`);
  console.log(`deleted records whose bytes are still stored (purge to retry): ${r.pendingPurge.length}`); for (const o of r.pendingPurge) console.log(`  ${o.key}`);
  console.log(`objects the application did not create (never touched): ${r.foreign.length}`);
  console.log(`MISSING objects (a database record points at nothing): ${r.missing.length}`); for (const k of r.missing) console.log(`  ${k}`);
  if (del) console.log(`deleted ${r.deleted.length} orphaned object(s)`);
  process.exit(r.missing.length > 0 ? 1 : 0);   // missing data is the serious case
}).catch((e) => { console.error("reconcile failed:", (e as Error).message); process.exit(1); });

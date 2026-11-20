import "dotenv/config";
import pg from "pg";

/**
 * Finishes the identifier normalisation of migration 0029 once conflicts are resolved. With --report it only lists the conflicts.
 * It never merges, deletes or picks between records: conflicts must be reconciled by an authorised person first.
 */
const url = process.env.MIGRATE_DATABASE_URL;
if (!url) { console.error("MIGRATE_DATABASE_URL is not set"); process.exit(1); }
const client = new pg.Client({ connectionString: url });
(async () => {
  await client.connect();
  const conflicts = (await client.query("SELECT * FROM app.identifier_conflicts() ORDER BY 1, 2, 3")).rows;
  if (conflicts.length) {
    console.log(`${conflicts.length} conflict(s). Nothing was changed.`);
    for (const c of conflicts) console.log(`- ${c.source_table} college ${c.college_id}: ${c.canonical} <- ${c.originals.join(" | ")} (records ${c.record_ids.join(", ")})`);
    process.exit(process.argv.includes("--report") ? 0 : 2);
  }
  if (process.argv.includes("--report")) { console.log("No conflicts."); return; }
  const changed = (await client.query("SELECT app.apply_identifier_normalization() AS n")).rows[0].n;
  await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'students_register_canonical') THEN
    ALTER TABLE students ADD CONSTRAINT students_register_canonical CHECK (register_number::text = app.canon_identifier(register_number::text)); END IF; END $$`);
  console.log(`Normalised ${changed} identifier(s). The canonical-form constraint is in place.`);
})().catch((e) => { console.error(e.message); process.exit(1); }).finally(() => client.end());

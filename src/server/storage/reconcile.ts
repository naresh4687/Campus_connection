import pg from "pg";
import { diffStorage, OUR_KEY, type DbFileRef } from "../../lib/reconcile";
import { deleteObject, listObjects } from "./s3";

/** Reads every file reference the database holds. Uses the owner connection with a read-only transaction that switches to the definer role (row-level security applies to the owner). */
export async function loadDbRefs(ownerUrl: string): Promise<DbFileRef[]> {
  const c = new pg.Client({ connectionString: ownerUrl });
  await c.connect();
  try {
    await c.query("BEGIN READ ONLY");
    await c.query("SET LOCAL ROLE cc_auth");
    const docs = await c.query<{ storage_key: string; status: string; purged_at: Date | null }>("SELECT storage_key, status, purged_at FROM documents");
    const files = await c.query<{ storage_key: string }>("SELECT storage_key FROM selection_files");
    await c.query("COMMIT");
    return [
      ...docs.rows.map((r): DbFileRef => ({ key: r.storage_key, state: r.status === "ACTIVE" ? "ACTIVE" : r.purged_at ? "PURGED" : "DELETED_PENDING_PURGE" })),
      ...files.rows.map((r): DbFileRef => ({ key: r.storage_key, state: "ACTIVE" })),
    ];
  } finally {
    await c.end();
  }
}

/** Compares storage with the database. Deleting is opt-in, limited to orphans older than the grace period, and only for keys the application generated. Database rows are never changed. */
export async function reconcile(opts: { ownerUrl: string; graceMinutes?: number; deleteOrphans?: boolean; now?: Date }) {
  const [refs, objects] = await Promise.all([loadDbRefs(opts.ownerUrl), listObjects()]);
  const report = diffStorage({ objects, refs, now: opts.now ?? new Date(), graceMinutes: opts.graceMinutes ?? 60 });
  const deleted: string[] = [];
  if (opts.deleteOrphans) for (const o of report.orphans) if (OUR_KEY.test(o.key)) { await deleteObject(o.key); deleted.push(o.key); }
  return { ...report, deleted };
}

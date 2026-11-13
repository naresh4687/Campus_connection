/** Pure comparison of what the database says exists with what object storage actually holds. Nothing here touches either system. */
export type StoredObject = { key: string; lastModified: Date };
export type DbFileRef = { key: string; state: "ACTIVE" | "DELETED_PENDING_PURGE" | "PURGED" };

/** Keys the application itself generates: documents `c/<college>/s/<student>/<id>` and offer files `c/<college>/o/<selection>/<id>`. Anything else is never touched. */
export const OUR_KEY = /^c\/[0-9a-f-]{36}\/(s|o)\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;

export function diffStorage({ objects, refs, now, graceMinutes }: { objects: StoredObject[]; refs: DbFileRef[]; now: Date; graceMinutes: number }) {
  const byKey = new Map(refs.map((r) => [r.key, r.state]));
  const have = new Set(objects.map((o) => o.key));
  const cutoff = now.getTime() - graceMinutes * 60_000;
  const orphans: StoredObject[] = []; const inFlight: StoredObject[] = []; const pendingPurge: StoredObject[] = []; const foreign: StoredObject[] = [];
  let ok = 0;
  for (const o of objects) {
    if (!OUR_KEY.test(o.key)) { foreign.push(o); continue; }
    const st = byKey.get(o.key);
    if (st === "ACTIVE") ok++;
    else if (st === "DELETED_PENDING_PURGE") pendingPurge.push(o);
    else if (o.lastModified.getTime() > cutoff) inFlight.push(o);        // no record (yet): an upload may still be registering — leave it alone
    else orphans.push(o);                                                // no record, or the record says the bytes were already purged
  }
  const missing = refs.filter((r) => r.state === "ACTIVE" && !have.has(r.key)).map((r) => r.key);
  return { ok, orphans, inFlight, pendingPurge, foreign, missing };
}

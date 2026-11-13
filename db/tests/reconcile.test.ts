import { randomUUID } from "node:crypto";
import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { appDb, closeAppDb, makeDepartment, makeStudentIn, seedTwoColleges, type Actor } from "./world";

// Uses its own bucket so it never sees development files. Requires the dev object store (docker compose up -d storage).
process.env.S3_BUCKET = "campusconnect-reconcile-test";
type Stu = Actor & { studentId: string };
let w: Awaited<ReturnType<typeof seedTwoColleges>>; let s: Stu;
let mod: typeof import("../../src/server/storage/reconcile"); let s3: typeof import("../../src/server/storage/s3");
const hex = () => randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "");
const register = async (key: string) => (await withTenantTx(s, (t) => sql<{ id: string }>`SELECT documents.register('RESUME', 'cv.pdf', 'application/pdf', 100, ${hex().slice(0, 64)}, ${key}) AS id`.execute(t), appDb())).rows[0].id;
const keyFor = () => `c/${s.collegeId}/s/${s.studentId}/${randomUUID()}`;

beforeAll(async () => {
  mod = await import("../../src/server/storage/reconcile"); s3 = await import("../../src/server/storage/s3");
  await s3.ensureBucket();
  for (const o of await s3.listObjects()) await s3.deleteObject(o.key);     // start from an empty test bucket
  w = await seedTwoColleges(); s = await makeStudentIn(w.A.admin, await makeDepartment(w.A.admin), "rec");
});
afterAll(async () => { for (const o of await s3.listObjects()) await s3.deleteObject(o.key); await closeAppDb(); });

describe("storage reconciliation against the real database and object store", () => {
  it("finds a planted orphan, a missing object and a deleted-but-unpurged file; matches the healthy one; deletes only what is allowed", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7 x %%EOF");
    const good = keyFor(); await register(good); await s3.putObject(good, bytes, "application/pdf");                     // healthy
    const missing = keyFor(); await register(missing);                                                                     // record, no bytes
    const orphan = keyFor(); await s3.putObject(orphan, bytes, "application/pdf");                                         // bytes, no record
    const pending = keyFor(); const pendingId = await register(pending); await s3.putObject(pending, bytes, "application/pdf");
    await withTenantTx(s, (t) => sql`SELECT documents.delete_document(${pendingId}::uuid)`.execute(t), appDb());           // deleted, bytes not purged
    const foreign = "backups/not-ours.dump"; await s3.putObject(foreign, bytes, "application/octet-stream");
    const url = process.env.TEST_MIGRATE_DATABASE_URL!;
    const later = new Date(Date.now() + 5 * 60_000);          // "now" a little ahead, so host/container clock skew cannot make a fresh object look recent

    const r = await mod.reconcile({ ownerUrl: url, graceMinutes: 0, now: later });
    expect(r.ok).toBe(1);
    expect(r.orphans.map((o) => o.key)).toEqual([orphan]);
    expect(r.missing.filter((k) => k.startsWith(`c/${s.collegeId}/`))).toEqual([missing]);       // other test files leave records without files in this database; look only at ours
    expect(r.pendingPurge.map((o) => o.key)).toEqual([pending]);
    expect(r.foreign.map((o) => o.key)).toEqual([foreign]);
    expect(r.deleted).toEqual([]);                                                                                          // read-only by default

    const withGrace = await mod.reconcile({ ownerUrl: url, graceMinutes: 60 });                                              // just uploaded: could still be registering
    expect(withGrace.orphans).toEqual([]); expect(withGrace.inFlight.map((o) => o.key)).toEqual([orphan]);

    const del = await mod.reconcile({ ownerUrl: url, graceMinutes: 0, now: later, deleteOrphans: true });
    expect(del.deleted).toEqual([orphan]);
    const after = (await s3.listObjects()).map((o) => o.key).sort();
    expect(after).toEqual([foreign, good, pending].sort());                                                                 // healthy, pending-purge and foreign objects untouched
    expect((await mod.reconcile({ ownerUrl: url, graceMinutes: 0, now: later })).orphans).toEqual([]);
  });
});

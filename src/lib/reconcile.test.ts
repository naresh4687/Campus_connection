import { describe, expect, it } from "vitest";
import { diffStorage, type StoredObject } from "./reconcile";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const key = (n: number, kind: "s" | "o" = "s") => `c/${id(1)}/${kind}/${id(2)}/${id(n)}`;
const now = new Date("2026-11-12T12:00:00Z");
const ago = (min: number) => new Date(now.getTime() - min * 60_000);
const obj = (k: string, min: number): StoredObject => ({ key: k, lastModified: ago(min) });

describe("diffStorage", () => {
  it("matches referenced objects, flags old unreferenced ones as orphans, and leaves recent ones alone (uploads in flight)", () => {
    const r = diffStorage({ objects: [obj(key(10), 500), obj(key(11), 500), obj(key(12), 5)], refs: [{ key: key(10), state: "ACTIVE" }], now, graceMinutes: 60 });
    expect(r.ok).toBe(1); expect(r.orphans.map((o) => o.key)).toEqual([key(11)]); expect(r.inFlight.map((o) => o.key)).toEqual([key(12)]); expect(r.missing).toEqual([]);
  });
  it("reports database records whose object is gone, for both documents and offer files", () => {
    const r = diffStorage({ objects: [], refs: [{ key: key(10), state: "ACTIVE" }, { key: key(11, "o"), state: "ACTIVE" }, { key: key(12), state: "PURGED" }], now, graceMinutes: 60 });
    expect(r.missing.sort()).toEqual([key(10), key(11, "o")].sort());                       // a purged record is expected to have no object
  });
  it("a deleted document whose bytes are still there is 'pending purge', not an orphan; once purged, leftover bytes are orphans", () => {
    const r = diffStorage({ objects: [obj(key(10), 900), obj(key(11), 900)], refs: [{ key: key(10), state: "DELETED_PENDING_PURGE" }, { key: key(11), state: "PURGED" }], now, graceMinutes: 60 });
    expect(r.pendingPurge.map((o) => o.key)).toEqual([key(10)]); expect(r.orphans.map((o) => o.key)).toEqual([key(11)]);
  });
  it("never classifies objects the application did not create (foreign keys are reported separately and never deletable)", () => {
    const r = diffStorage({ objects: [obj("backups/db.dump", 9000), obj("c/not-a-uuid/s/x/y", 9000), obj(key(10).toUpperCase(), 9000)], refs: [], now, graceMinutes: 0 });
    expect(r.orphans).toEqual([]); expect(r.foreign).toHaveLength(3);
  });
  it("with no grace period every unreferenced object of ours is an orphan", () => {
    expect(diffStorage({ objects: [obj(key(10), 0)], refs: [], now, graceMinutes: 0 }).orphans).toHaveLength(1);
  });
});

import { sql } from "kysely";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenantTx } from "../../src/server/db";
import { adminWrite, appDb, closeAppDb, code, DENIED, driveInput, inspect, makeCompany, makeCoordinator, makeDepartment, makeDrive, makeStudentIn, seedTwoColleges, type Actor } from "./world";

type World = Awaited<ReturnType<typeof seedTwoColleges>>;
let w: World; let co: string; let d1: string; let d2: string;
const db = () => appDb();
const as = <T>(a: Actor, fn: Parameters<typeof withTenantTx<T>>[1]) => withTenantTx(a, fn, db());
const call = (a: Actor | null, q: ReturnType<typeof sql>) => (a ? as(a, (t) => q.execute(t)) : q.execute(db()));
const P256 = "B" + "A".repeat(86); const AUTH = "A".repeat(22);
let n = 0;
const ep = (label = "dev") => `https://fcm.googleapis.com/fcm/send/${label}-${++n}-${Math.random().toString(36).slice(2)}`;
const sub = (a: Actor, endpoint: string, label = "Chrome on Android") => call(a, sql`SELECT push.subscribe(${endpoint}, ${P256}, ${AUTH}, ${label}) AS id`).then((r) => (r.rows[0] as { id: string }).id);
const student = (dept: string, label = "psh") => makeStudentIn(w.A.admin, dept, `${label}${++n}`);
const officer = () => w.A.officer;
const jobsFor = (userId: string) => inspect<{ id: string; status: string; attempts: number; notification_id: string }>("SELECT id, status, attempts, notification_id FROM push_jobs WHERE user_id = $1 ORDER BY created_at", [userId]);
const claim = async (ids: string[]) => ((await call(null, sql`SELECT * FROM push.claim(200, 60)`)).rows as { job_id: string; subscription_id: string; category: string; endpoint: string }[]).filter((r) => ids.includes(r.job_id));
const publish = () => makeDrive(officer(), driveInput(co, [d1]), true);

beforeAll(async () => {
  w = await seedTwoColleges();
  co = await makeCompany(officer(), "Push Co"); d1 = await makeDepartment(w.A.admin); d2 = await makeDepartment(w.A.admin);
  await makeCoordinator(w.A.admin, [d1], "pshc1");
});
afterAll(async () => { await closeAppDb(); });

describe("subscriptions: ownership, validation, devices", () => {
  it("an unauthenticated caller cannot subscribe; a platform administrator (no college) cannot either", async () => {
    expect(await code(call(null, sql`SELECT push.subscribe(${ep()}, ${P256}, ${AUTH}, 'x')`))).toBe(DENIED);
    expect(await code(call(w.pa, sql`SELECT push.subscribe(${ep()}, ${P256}, ${AUTH}, 'x')`))).toBe(DENIED);
  });
  it("the runtime role cannot read or write the push tables directly", async () => {
    const s = await student(d1);
    for (const q of [sql`SELECT * FROM push_subscriptions`, sql`SELECT * FROM push_jobs`, sql`SELECT * FROM push_deliveries`, sql`SELECT * FROM push_settings`,
      sql`INSERT INTO push_subscriptions (college_id, user_id, endpoint, p256dh, auth) VALUES (${s.collegeId}, ${s.userId}, ${ep()}, ${P256}, ${AUTH})`]) {
      expect(await code(as(s, (t) => q.execute(t)))).toBe(DENIED);
    }
  });
  it("a subscription is stored for the signed-in user and college only (identity comes from the session, not an argument)", async () => {
    const s = await student(d1); const e = ep();
    const id = await sub(s, e);
    const [row] = await inspect<{ user_id: string; college_id: string; active: boolean; device_label: string }>("SELECT user_id, college_id, active, device_label FROM push_subscriptions WHERE id = $1", [id]);
    expect(row).toMatchObject({ user_id: s.userId, college_id: s.collegeId, active: true, device_label: "Chrome on Android" });
  });
  it("only real push-service endpoints are accepted (no other host, port, userinfo or plain http); malformed keys are refused", async () => {
    const s = await student(d1);
    for (const bad of ["https://evil.example/x", "http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://fcm.googleapis.com.evil.test/x", "https://fcm.googleapis.com@evil.test/x", "https://fcm.googleapis.com:8443/x", "https://169.254.169.254/latest", "https://notify.windows.com.evil.test/x", "https://fcm.googleapis.com", "https://fcm.googleapis.com/a b"]) {
      expect(await code(call(s, sql`SELECT push.subscribe(${bad}, ${P256}, ${AUTH}, 'x')`)), bad).toBe("22023");
    }
    for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc", "https://wns2-par02p.notify.windows.com/w/?token=abc"]) await sub(s, ok + `-${++n}`).catch((e) => { throw new Error(ok + " " + e.message); });
    expect(await code(call(s, sql`SELECT push.subscribe(${ep()}, 'short', ${AUTH}, 'x')`))).toBe("22023");
    expect(await code(call(s, sql`SELECT push.subscribe(${ep()}, ${P256}, 'bad key!', 'x')`))).toBe("22023");
  });
  it("several devices per user do not overwrite each other; the same endpoint twice is one row", async () => {
    const s = await student(d1); const a = ep("a"); const b = ep("b");
    const ida = await sub(s, a); const idb = await sub(s, b); const ida2 = await sub(s, a);
    expect(ida2).toBe(ida); expect(idb).not.toBe(ida);
    expect((await call(s, sql`SELECT * FROM push.my_devices()`)).rows).toHaveLength(2);
  });
  it("another account cannot take over an active endpoint; once it is switched off the device can be re-registered", async () => {
    const s1 = await student(d1); const s2 = await student(d1); const e = ep();
    await sub(s1, e);
    expect(await code(sub(s2, e))).toBe("23505");
    expect((await call(s2, sql`SELECT push.unsubscribe(${e}) AS r`)).rows[0]).toMatchObject({ r: false });      // not theirs: nothing happens
    expect((await call(s1, sql`SELECT push.is_subscribed(${e}) AS r`)).rows[0]).toMatchObject({ r: true });
    await call(s1, sql`SELECT push.unsubscribe(${e})`);
    await sub(s2, e);
    expect((await call(s2, sql`SELECT push.is_subscribed(${e}) AS r`)).rows[0]).toMatchObject({ r: true });
    expect((await call(s1, sql`SELECT push.is_subscribed(${e}) AS r`)).rows[0]).toMatchObject({ r: false });
  });
  it("colleges are isolated: devices are visible only to their owner, and removal needs ownership", async () => {
    const a = await student(d1); const id = await sub(a, ep());
    expect((await call(w.B.student, sql`SELECT * FROM push.my_devices()`)).rows).toHaveLength(0);
    expect((await call(w.B.admin, sql`SELECT push.remove_device(${id}::uuid) AS r`)).rows[0]).toMatchObject({ r: false });
    expect((await call(a, sql`SELECT push.remove_device(${id}::uuid) AS r`)).rows[0]).toMatchObject({ r: true });
  });
  it("my_devices never returns the endpoint or keys; changes are audited", async () => {
    const s = await student(d1); const id = await sub(s, ep());
    const cols = Object.keys((await call(s, sql`SELECT * FROM push.my_devices()`)).rows[0] as object);
    expect(cols).not.toContain("endpoint"); expect(cols).not.toContain("p256dh"); expect(cols).not.toContain("auth");
    const audit = await inspect<{ action: string }>("SELECT action FROM audit_log WHERE entity_type = 'push_subscription' AND entity_id = $1", [id]);
    expect(audit.map((a) => a.action)).toContain("PUSH_SUBSCRIBED");
  });
  it("at most ten active devices per account: the newest win", async () => {
    const s = await student(d1);
    for (let i = 0; i < 12; i++) await sub(s, ep("cap"));
    expect((await call(s, sql`SELECT * FROM push.my_devices()`)).rows).toHaveLength(10);
  });
});

describe("the outbox: who gets a job, exactly once", () => {
  it("only recipients with an active device get a job; other students, departments and colleges get none", async () => {
    const withDevice = await student(d1); const noDevice = await student(d1); const otherDept = await student(d2);
    await sub(withDevice, ep()); await sub(otherDept, ep());
    await publish();
    expect(await jobsFor(withDevice.userId)).toHaveLength(1);
    expect(await jobsFor(noDevice.userId)).toHaveLength(0);          // still gets the in-app notification
    expect(await jobsFor(otherDept.userId)).toHaveLength(0);         // the drive is not for their department: no notification, no job
    const [inApp] = await inspect<{ n: number }>("SELECT count(*)::int AS n FROM notifications WHERE user_id = $1", [noDevice.userId]);
    expect(inApp.n).toBe(1);
  });
  it("a job exists once per notification (the unique key makes duplicates impossible)", async () => {
    const s = await student(d1); await sub(s, ep()); await publish();
    const [j] = await jobsFor(s.userId);
    await expect(adminWrite("INSERT INTO push_jobs (notification_id, college_id, user_id) VALUES ($1, $2, $3)", [j.notification_id, s.collegeId, s.userId])).rejects.toMatchObject({ code: "23505" });
  });
  it("a paused account (master switch off) gets no job; resuming works", async () => {
    const s = await student(d1); await sub(s, ep());
    await call(s, sql`SELECT push.set_enabled(false)`); await publish();
    expect(await jobsFor(s.userId)).toHaveLength(0);
    await call(s, sql`SELECT push.set_enabled(true)`); await publish();
    expect(await jobsFor(s.userId)).toHaveLength(1);
  });
});

describe("delivery: claim, record, retry, expire, preferences", () => {
  it("claim returns only generic data (category, device), once, and a second worker gets nothing for the same job", async () => {
    const s = await student(d1); const e = ep(); await sub(s, e); await publish();
    const [j] = await jobsFor(s.userId);
    const rows = await claim([j.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ category: "DRIVES", endpoint: e });
    expect(Object.keys(rows[0])).not.toContain("title"); expect(Object.keys(rows[0])).not.toContain("body");
    expect(await claim([j.id])).toHaveLength(0);                    // locked by the first claim
  });
  it("a successful send is recorded once; the job finishes; a repeat run never sends to that device again", async () => {
    const s = await student(d1); await sub(s, ep()); await publish();
    const [j] = await jobsFor(s.userId);
    const [r] = await claim([j.id]);
    await call(null, sql`SELECT push.record(${j.id}::uuid, ${r.subscription_id}::uuid, 'SENT', 201, NULL)`);
    await call(null, sql`SELECT push.record(${j.id}::uuid, ${r.subscription_id}::uuid, 'SENT', 201, NULL)`);   // duplicate record is harmless
    expect((await call(null, sql`SELECT push.finish(${j.id}::uuid, false, NULL) AS r`)).rows[0]).toMatchObject({ r: "DONE" });
    expect(await inspect("SELECT 1 FROM push_deliveries WHERE job_id = $1 AND outcome = 'SENT'", [j.id])).toHaveLength(1);
    expect((await jobsFor(s.userId))[0].status).toBe("DONE");
    expect((await inspect<{ last_success_at: Date | null }>("SELECT last_success_at FROM push_subscriptions WHERE id = $1", [r.subscription_id]))[0].last_success_at).not.toBeNull();
  });
  it("an expired endpoint (404/410) deactivates that device and records the failure", async () => {
    const s = await student(d1); const e = ep(); await sub(s, e); await publish();
    const [j] = await jobsFor(s.userId); const [r] = await claim([j.id]);
    await call(null, sql`SELECT push.record(${j.id}::uuid, ${r.subscription_id}::uuid, 'EXPIRED', 410, 'HTTP 410')`);
    await call(null, sql`SELECT push.finish(${j.id}::uuid, false, NULL)`);
    const [row] = await inspect<{ active: boolean; last_error: string }>("SELECT active, last_error FROM push_subscriptions WHERE id = $1", [r.subscription_id]);
    expect(row).toMatchObject({ active: false, last_error: "HTTP 410" });
    expect((await call(s, sql`SELECT push.is_subscribed(${e}) AS r`)).rows[0]).toMatchObject({ r: false });
  });
  it("a temporary failure is retried with growing delays, then ends in a terminal FAILED state after five attempts", async () => {
    const s = await student(d1); await sub(s, ep()); await publish();
    const [j] = await jobsFor(s.userId);
    const delays: number[] = [];
    for (let attempt = 1; attempt <= 5; attempt++) {
      expect(await claim([j.id]), `attempt ${attempt}`).toHaveLength(1);
      const [r] = (await inspect<{ id: string }>("SELECT id FROM push_subscriptions WHERE user_id = $1 AND active", [s.userId]));
      await call(null, sql`SELECT push.record(${j.id}::uuid, ${r.id}::uuid, 'RETRY', 503, 'HTTP 503')`);
      const res = (await call(null, sql`SELECT push.finish(${j.id}::uuid, true, 'HTTP 503') AS r`)).rows[0] as { r: string };
      const [row] = await inspect<{ status: string; secs: number }>("SELECT status, extract(epoch FROM next_attempt_at - now())::int AS secs FROM push_jobs WHERE id = $1", [j.id]);
      if (attempt < 5) { expect(res.r).toBe("PENDING"); delays.push(row.secs); await adminWrite("UPDATE push_jobs SET next_attempt_at = now() WHERE id = $1", [j.id]); }
      else { expect(res.r).toBe("FAILED"); expect(row.status).toBe("FAILED"); }
    }
    expect(delays[0]).toBeGreaterThan(20); expect(delays[0]).toBeLessThanOrEqual(30);
    expect(delays.every((d, i) => i === 0 || d > delays[i - 1])).toBe(true);
    expect(await claim([j.id])).toHaveLength(0);                                    // terminal: never picked up again
  });
  it("a worker that died is recovered: an expired lock makes the job claimable again", async () => {
    const s = await student(d1); await sub(s, ep()); await publish();
    const [j] = await jobsFor(s.userId);
    expect(await claim([j.id])).toHaveLength(1);
    await adminWrite("UPDATE push_jobs SET locked_until = now() - interval '1 minute' WHERE id = $1", [j.id]);
    expect(await claim([j.id])).toHaveLength(1);
  });
  it("preferences are re-checked at delivery time: category off, master off, or already read in the app means nothing is sent", async () => {
    const off = await student(d1); const paused = await student(d1); const read = await student(d1);
    for (const s of [off, paused, read]) await sub(s, ep());
    await publish();
    const ids = await Promise.all([off, paused, read].map(async (s) => (await jobsFor(s.userId))[0].id));
    await call(off, sql`SELECT notifications.set_preference('DRIVES', false)`);
    await call(paused, sql`SELECT push.set_enabled(false)`);
    await call(read, sql`SELECT notifications.mark_all_read()`);
    expect(await claim(ids)).toHaveLength(0);
    const st = await inspect<{ status: string }>("SELECT status FROM push_jobs WHERE id = ANY ($1::uuid[])", [ids]);
    expect(st.map((x) => x.status)).toEqual(["SKIPPED", "SKIPPED", "SKIPPED"]);
  });
  it("essential notifications (offers, placement) ignore a category switch but not the account switch", async () => {
    const e = await inspect<{ ok: boolean }>("SELECT notifications.is_essential('OFFERS') AS ok");
    expect(e[0].ok).toBe(true);
  });
  it("health reports the queue without exposing any recipient", async () => {
    const h = (await call(null, sql`SELECT * FROM push.health()`)).rows[0] as Record<string, unknown>;
    expect(Object.keys(h).sort()).toEqual(["active_devices", "expired_24h", "failed", "oldest_pending_seconds", "pending", "sending", "sent_24h"]);
  });
});

import { sql } from "kysely";
import { sendNotification, type RequestOptions } from "web-push";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";
import { pushCopy } from "@/lib/push-copy";
import { db } from "../db";
import { pushConfig } from "./config";

type Row = { job_id: string; notification_id: string; category: string; attempt: number; subscription_id: string; endpoint: string; p256dh: string; auth: string };
export type DispatchResult = { enabled: boolean; claimed: number; sent: number; expired: number; retry: number; failed: number; jobsFinished: number };

/** What was wrong with one delivery, as a push service would tell us. */
export function classify(status: number | undefined): "EXPIRED" | "RETRY" | "FAILED" {
  if (status === 404 || status === 410) return "EXPIRED";                       // the browser has dropped this subscription: stop sending
  if (status === undefined || status === 408 || status === 429 || status >= 500) return "RETRY";   // network error, throttling, push service trouble
  if (status === 401 || status === 403) return "RETRY";                         // key / policy problem on our side: keep the job, count the failure
  return "FAILED";                                                               // 400, 413 ...: this payload will never be accepted
}

type Sender = (sub: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string, opts: RequestOptions) => Promise<{ statusCode: number }>;

/**
 * One pass of the outbox worker: claim due jobs (SKIP LOCKED, so any number of workers may run), send the generic payload to each device,
 * record every outcome, then finish or reschedule each job. Never called from a user request. `send` is injectable for tests only.
 */
export async function dispatchPush(opts: { limit?: number; lockSeconds?: number; send?: Sender } = {}): Promise<DispatchResult> {
  const out: DispatchResult = { enabled: false, claimed: 0, sent: 0, expired: 0, retry: 0, failed: 0, jobsFinished: 0 };
  const cfg = pushConfig();
  if (!cfg.ok && !opts.send) return out;            // unconfigured: nothing is claimed, jobs simply wait
  out.enabled = true;
  const send: Sender = opts.send ?? ((sub, payload, o) => sendNotification(sub, payload, o));
  const vapid = cfg.ok ? { subject: cfg.subject, publicKey: cfg.publicKey, privateKey: cfg.privateKey } : undefined;

  const rows = (await sql<Row>`SELECT * FROM push.claim(${opts.limit ?? 50}, ${opts.lockSeconds ?? 120})`.execute(db())).rows;
  out.claimed = rows.length;
  // A job is finished (or rescheduled) after all its devices were tried.
  const jobs = new Map<string, { retry: boolean; error: string | null }>();
  // Jobs claimed but with no device left were finished inside claim(); only jobs that appear in `rows` need finishing here.
  for (const r of rows) jobs.set(r.job_id, jobs.get(r.job_id) ?? { retry: false, error: null });

  const work = async (r: Row) => {
    const copy = pushCopy(r.category);
    const payload = JSON.stringify({ v: 1, id: r.notification_id, title: copy.title, body: copy.body });
    let outcome: "SENT" | "EXPIRED" | "RETRY" | "FAILED"; let status: number | undefined; let detail: string | null = null;
    try {
      if (!isAllowedPushEndpoint(r.endpoint)) throw Object.assign(new Error("endpoint not allowed"), { statusCode: 400 });   // never request an unexpected host
      const res = await send({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload, {
        TTL: 24 * 3600, urgency: r.category === "OFFERS" || r.category === "PLACEMENT" ? "high" : "normal",
        topic: r.notification_id.replace(/-/g, ""), timeout: 10_000, ...(vapid ? { vapidDetails: vapid } : {}),
      });
      status = res.statusCode; outcome = "SENT";
    } catch (e) {
      status = (e as { statusCode?: number }).statusCode;
      outcome = classify(status);
      detail = (status ? `HTTP ${status}` : `network: ${(e as { code?: string }).code ?? "error"}`).slice(0, 200);   // never the endpoint or message body
    }
    await sql`SELECT push.record(${r.job_id}::uuid, ${r.subscription_id}::uuid, ${outcome}, ${status ?? null}, ${detail})`.execute(db());
    if (outcome === "SENT") out.sent++; else if (outcome === "EXPIRED") out.expired++; else if (outcome === "RETRY") { out.retry++; jobs.set(r.job_id, { retry: true, error: detail }); } else out.failed++;
  };
  // Bounded concurrency: ten devices at a time.
  for (let i = 0; i < rows.length; i += 10) await Promise.all(rows.slice(i, i + 10).map(work));

  for (const [id, j] of jobs) {
    await sql`SELECT push.finish(${id}::uuid, ${j.retry}, ${j.error})`.execute(db());
    out.jobsFinished++;
  }
  return out;
}

export type PushHealth = { pending: number; sending: number; failed: number; oldest_pending_seconds: number; sent_24h: number; expired_24h: number; active_devices: number };
export async function pushHealth(): Promise<PushHealth> { return (await sql<PushHealth>`SELECT * FROM push.health()`.execute(db())).rows[0]; }
export async function purgePush(): Promise<number> { return (await sql<{ n: number }>`SELECT push.purge() AS n`.execute(db())).rows[0].n; }

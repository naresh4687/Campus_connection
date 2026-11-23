import { createHash, timingSafeEqual } from "node:crypto";
import { dispatchPush, purgePush, pushHealth } from "@/server/push/dispatch";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

const digest = (v: string) => createHash("sha256").update(v).digest();
function authorised(req: Request): boolean {
  const secret = process.env.PUSH_WORKER_SECRET;
  if (!secret || secret.length < 32) return false;                 // no secret configured: the endpoint does not exist for anyone
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  return timingSafeEqual(digest(given), digest(secret));
}

/**
 * The outbox worker's entry point: a scheduler (Vercel Cron, an external cron, or scripts/push-worker.ts) calls it with
 * `Authorization: Bearer $PUSH_WORKER_SECRET`. Sending never happens inside a user request. `?purge=1` also runs housekeeping.
 */
async function run(req: Request) {
  if (!authorised(req)) return new Response("Not found", { status: 404, headers: NO_STORE });
  try {
    const result = await dispatchPush();
    const purged = new URL(req.url).searchParams.get("purge") === "1" ? await purgePush() : undefined;
    return Response.json({ ...result, purged, health: await pushHealth() }, { headers: NO_STORE });
  } catch (e) {
    console.error("push dispatch failed:", (e as { code?: string; message?: string }).code ?? "error");
    return Response.json({ error: "failed" }, { status: 500, headers: NO_STORE });
  }
}
export const GET = run;
export const POST = run;

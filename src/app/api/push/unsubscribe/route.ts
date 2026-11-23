import { z } from "zod";
import { json, pushRequest } from "@/server/push/route-utils";
import { unsubscribeDevice } from "@/server/push/subscriptions";

export const dynamic = "force-dynamic";

/** Turns this browser's subscription off for the signed-in user (only their own; anyone else's endpoint simply matches nothing). */
export async function POST(req: Request) {
  const r = await pushRequest(req, "unsubscribe", 60);
  if ("res" in r) return r.res;
  const p = z.object({ endpoint: z.string().max(1000) }).safeParse(r.body);
  if (!p.success) return json({ error: "invalid" }, 400);
  try { return json({ ok: true, removed: await unsubscribeDevice(r.s, p.data.endpoint) }); }
  catch (e) { console.error("push unsubscribe failed:", (e as { code?: string }).code); return json({ error: "failed" }, 500); }
}

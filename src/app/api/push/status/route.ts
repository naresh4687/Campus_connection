import { z } from "zod";
import { pushConfig } from "@/server/push/config";
import { json, pushRequest } from "@/server/push/route-utils";
import { deviceStatus } from "@/server/push/subscriptions";

export const dynamic = "force-dynamic";

/** Is this browser's subscription active for me, and is my account switch on? Lets the page repair a subscription the browser rotated. */
export async function POST(req: Request) {
  const r = await pushRequest(req, "status", 120);
  if ("res" in r) return r.res;
  const p = z.object({ endpoint: z.string().max(1000) }).safeParse(r.body);
  if (!p.success) return json({ error: "invalid" }, 400);
  try { const st = await deviceStatus(r.s, p.data.endpoint); return json({ available: pushConfig().ok, subscribed: st.sub, enabled: st.en }); }
  catch (e) { console.error("push status failed:", (e as { code?: string }).code); return json({ error: "failed" }, 500); }
}

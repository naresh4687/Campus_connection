import { pushConfig } from "@/server/push/config";
import { json, pushRequest, userAgentHeader } from "@/server/push/route-utils";
import { deviceLabel, subscribeDevice, subscriptionSchema } from "@/server/push/subscriptions";

export const dynamic = "force-dynamic";

/** Saves THIS browser's push subscription for the signed-in user. The user comes from the session, never from the body. */
export async function POST(req: Request) {
  const r = await pushRequest(req, "subscribe", 30);
  if ("res" in r) return r.res;
  if (!pushConfig().ok) return json({ error: "unavailable" }, 503);
  const parsed = subscriptionSchema.safeParse(r.body);
  if (!parsed.success) return json({ error: "invalid subscription" }, 400);
  try {
    await subscribeDevice(r.s, parsed.data, deviceLabel(await userAgentHeader()));
    return json({ ok: true });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "23505") return json({ error: "conflict" }, 409);     // endpoint is active for another account: the browser makes a new one
    if (code === "22023") return json({ error: "invalid subscription" }, 400);
    console.error("push subscribe failed:", code);
    return json({ error: "failed" }, 500);
  }
}

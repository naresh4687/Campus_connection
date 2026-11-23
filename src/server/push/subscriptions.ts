import { sql } from "kysely";
import { z } from "zod";
import { isAllowedPushEndpoint } from "@/lib/push-endpoint";
import { withSession, type SessionUser } from "../auth/session";

export const subscriptionSchema = z.object({
  endpoint: z.string().max(1000).refine(isAllowedPushEndpoint, "not a push service endpoint"),
  keys: z.object({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{80,100}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{20,32}$/) }),
  label: z.string().max(80).optional(),
});
export type PushDevice = { id: string; device_label: string | null; created_at: Date; last_success_at: Date | null };

/** A short, harmless device description from the User-Agent ("Chrome on Android"). Never stores the raw header. */
export function deviceLabel(ua: string | null): string {
  const u = ua ?? "";
  const os = /Android/i.test(u) ? "Android" : /iPhone|iPad|iPod/i.test(u) ? "iOS" : /Windows/i.test(u) ? "Windows" : /Mac OS X|Macintosh/i.test(u) ? "macOS" : /CrOS/i.test(u) ? "ChromeOS" : /Linux/i.test(u) ? "Linux" : "Unknown OS";
  const br = /Edg\//i.test(u) ? "Edge" : /OPR\/|Opera/i.test(u) ? "Opera" : /Firefox|FxiOS/i.test(u) ? "Firefox" : /Chrome|CriOS/i.test(u) ? "Chrome" : /Safari/i.test(u) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}

export const subscribeDevice = (s: SessionUser, sub: z.infer<typeof subscriptionSchema>, label: string) =>
  withSession(s, async (t) => {
    const id = (await sql<{ id: string }>`SELECT push.subscribe(${sub.endpoint}, ${sub.keys.p256dh}, ${sub.keys.auth}, ${label}) AS id`.execute(t)).rows[0].id;
    await sql`SELECT push.set_enabled(true)`.execute(t);   // turning notifications on for a device turns the account switch on too
    return id;
  });
export const unsubscribeDevice = (s: SessionUser, endpoint: string) => withSession(s, async (t) => (await sql<{ r: boolean }>`SELECT push.unsubscribe(${endpoint}) AS r`.execute(t)).rows[0].r);
export const removeDevice = (s: SessionUser, id: string) => withSession(s, async (t) => (await sql<{ r: boolean }>`SELECT push.remove_device(${id}::uuid) AS r`.execute(t)).rows[0].r);
export const listDevices = (s: SessionUser) => withSession(s, async (t) => (await sql<PushDevice>`SELECT * FROM push.my_devices()`.execute(t)).rows);
export const pushEnabled = (s: SessionUser) => withSession(s, async (t) => (await sql<{ e: boolean }>`SELECT push.get_enabled() AS e`.execute(t)).rows[0].e);
export const setPushEnabled = (s: SessionUser, on: boolean) => withSession(s, (t) => sql`SELECT push.set_enabled(${on})`.execute(t));
export const deviceStatus = (s: SessionUser, endpoint: string) => withSession(s, async (t) => (await sql<{ sub: boolean; en: boolean }>`SELECT push.is_subscribed(${endpoint}) AS sub, push.get_enabled() AS en`.execute(t)).rows[0]);

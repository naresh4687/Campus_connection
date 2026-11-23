import { z } from "zod";

const b64url = (len: number) => new RegExp(`^[A-Za-z0-9_-]{${len}}$`);
const schema = z.object({
  VAPID_PUBLIC_KEY: z.string().regex(b64url(87), "VAPID_PUBLIC_KEY must be a 65-byte P-256 key in base64url (87 characters)"),
  VAPID_PRIVATE_KEY: z.string().regex(b64url(43), "VAPID_PRIVATE_KEY must be a 32-byte key in base64url (43 characters)"),
  VAPID_SUBJECT: z.string().refine((v) => /^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) || /^https:\/\/[^\s]+$/.test(v), "VAPID_SUBJECT must be mailto:you@example.com or an https URL"),
});

export type PushConfig = { ok: true; publicKey: string; privateKey: string; subject: string } | { ok: false; reason: string };

let cached: PushConfig | undefined;
/**
 * Push settings, validated once. Missing or malformed settings never crash the app: push is simply unavailable (the UI says so) and the
 * in-app notifications carry on. The private key is read only here, on the server, and never passed to a component.
 */
export function pushConfig(): PushConfig {
  if (cached) return cached;
  if (!process.env.VAPID_PUBLIC_KEY && !process.env.VAPID_PRIVATE_KEY) return (cached = { ok: false, reason: "not configured" });
  const r = schema.safeParse(process.env);
  cached = r.success
    ? { ok: true, publicKey: r.data.VAPID_PUBLIC_KEY, privateKey: r.data.VAPID_PRIVATE_KEY, subject: r.data.VAPID_SUBJECT }
    : { ok: false, reason: r.error.issues.map((i) => i.message).join("; ") };
  if (!r.success) console.error("push disabled:", cached.ok ? "" : cached.reason);
  return cached;
}

/** The only value the browser needs. */
export const pushPublicKey = (): string | null => { const c = pushConfig(); return c.ok ? c.publicKey : null; };
export const resetPushConfigForTests = () => { cached = undefined; };

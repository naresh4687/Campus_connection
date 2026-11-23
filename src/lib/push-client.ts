/** Browser side of Web Push. Every function is called from a click or a page effect inside a component, never at import time. */
export type PushSupport = "supported" | "no-service-worker" | "no-push" | "no-notification";
export type PushState = "loading" | "unsupported" | "unavailable" | "denied" | "off" | "on" | "error";

export function pushSupport(): PushSupport {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return "no-service-worker";
  if (!("PushManager" in window) || !window.PushManager) return "no-push";
  if (!("Notification" in window)) return "no-notification";
  return "supported";
}

const toKey = (b64: string) => {
  const raw = atob((b64 + "=".repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};
const toB64Url = (buf: ArrayBuffer | null) => {
  if (!buf) return "";
  let s = ""; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const post = (path: string, slot: string, body: unknown) =>
  fetch(`${path}?as=${encodeURIComponent(slot)}`, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });

async function ready(): Promise<ServiceWorkerRegistration> {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<never>((_, rej) => setTimeout(() => rej(new Error("The app service is not ready yet. Reload the page and try again.")), 8000))]);
  return reg;
}
const body = (sub: PushSubscription) => ({ endpoint: sub.endpoint, keys: { p256dh: toB64Url(sub.getKey("p256dh")), auth: toB64Url(sub.getKey("auth")) } });

/** The current subscription for this browser, if any. */
export async function currentSubscription() { try { return await (await ready()).pushManager.getSubscription(); } catch { return null; } }

/**
 * Enable: ask permission (this call must come from a click), subscribe, save on the server, and only then report success.
 * A refused or failed step is returned as a message; nothing is shown as enabled unless the server confirmed it.
 */
export async function enablePush(publicKey: string, slot: string): Promise<{ ok: true } | { ok: false; reason: "denied" | "error"; message: string }> {
  try {
    if (pushSupport() !== "supported") return { ok: false, reason: "error", message: "This browser does not support push notifications." };
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    if (permission !== "granted") return { ok: false, reason: "denied", message: "Notifications are blocked for this site." };
    const reg = await ready();
    const key = toKey(publicKey);
    let sub = await reg.pushManager.getSubscription();
    if (sub && toB64Url(sub.options.applicationServerKey) !== publicKey) { await sub.unsubscribe(); sub = null; }   // made with other server keys
    let created = false;
    if (!sub) { sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource }); created = true; }
    let res = await post("/api/push/subscribe", slot, body(sub));
    if (res.status === 409) {   // this browser's subscription is active for another account: make a fresh one for this account
      await sub.unsubscribe();
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource }); created = true;
      res = await post("/api/push/subscribe", slot, body(sub));
    }
    if (!res.ok) { if (created) await sub.unsubscribe().catch(() => {}); return { ok: false, reason: "error", message: res.status === 503 ? "Push notifications are temporarily unavailable." : res.status === 429 ? "Too many attempts. Try again later." : "Could not save this device. Please try again." }; }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error && e.message ? e.message : "Could not turn on notifications. Please try again." };
  }
}

/** Disable on this device: tell the server first, then drop the browser subscription. */
export async function disablePush(slot: string): Promise<boolean> {
  try {
    const sub = await currentSubscription();
    if (!sub) return true;
    const res = await post("/api/push/unsubscribe", slot, { endpoint: sub.endpoint });
    if (!res.ok) return false;
    // Drop the browser's subscription only if it was THIS account's (another signed-in account in the same browser may own it).
    if (((await res.json()) as { removed?: boolean }).removed) await sub.unsubscribe();
    return true;
  } catch { return false; }
}

/** Page-load check: is this browser's subscription still active on the server? Re-saves it silently if the browser still holds it but the server lost it. */
export async function syncPush(publicKey: string, slot: string): Promise<{ subscribed: boolean; enabled: boolean } | null> {
  try {
    const sub = await currentSubscription();
    if (!sub) return { subscribed: false, enabled: true };
    const res = await post("/api/push/status", slot, { endpoint: sub.endpoint });
    if (!res.ok) return null;
    const st = (await res.json()) as { subscribed: boolean; enabled: boolean };
    if (!st.subscribed && st.enabled && Notification.permission === "granted") {
      const r = await post("/api/push/subscribe", slot, body(sub));
      return { subscribed: r.ok, enabled: st.enabled };
    }
    return st;
  } catch { return null; }
}

/** Sign-out housekeeping: switch this device off for the account that is leaving and drop anything we cached. Best effort; never blocks sign-out. */
export async function cleanupOnSignOut(slot: string) {
  const work = (async () => {
    try { await disablePush(slot); } catch { /* ignore */ }
    try { for (const k of await caches.keys()) if (k.endsWith("-static") || k.includes("private")) await caches.delete(k); } catch { /* ignore */ }
    try { sessionStorage.clear(); } catch { /* ignore */ }
  })();
  await Promise.race([work, new Promise((r) => setTimeout(r, 2500))]);
}

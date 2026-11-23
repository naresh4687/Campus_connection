"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { disablePush, enablePush, pushSupport, syncPush, type PushState } from "@/lib/push-client";

const btn = "inline-flex h-11 items-center rounded-full px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-60";
const KEY = "cc-push-prompt-dismissed";

/**
 * Turn push notifications on or off for THIS device. Permission is requested only when the person presses "Turn on notifications".
 * `compact` (the notifications page) is a small invitation shown only while notifications are off and not refused; it can be dismissed.
 */
export function PushControls({ publicKey, slot, compact = false }: { publicKey: string | null; slot: string; compact?: boolean }) {
  const [inner, setState] = useState<PushState>("loading");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const acted = useRef(false);   // once the person has pressed a button, the page-load check must not overwrite the result
  const [notNowClicked, setNotNowClicked] = useState(false);
  const storedDismissal = useSyncExternalStore(() => () => {}, () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } }, () => true);
  const dismissed = storedDismissal || notNowClicked;

  // What this browser and server allow at all (client-only facts; the server render assumes "ok").
  const env = useSyncExternalStore<PushState | "ok">(() => () => {}, () => (!publicKey ? "unavailable" : pushSupport() !== "supported" ? "unsupported" : Notification.permission === "denied" ? "denied" : "ok"), () => "ok");
  const state: PushState = env !== "ok" ? env : inner;

  // Page load: is this browser's subscription still active on the server? (Re-saves it quietly if the browser kept it but the server lost it.)
  useEffect(() => {
    if (!publicKey || pushSupport() !== "supported" || Notification.permission === "denied") return;
    let alive = true;
    void syncPush(publicKey, slot).then((st) => { if (alive && !acted.current) setState(st?.subscribed && Notification.permission === "granted" ? "on" : "off"); });
    return () => { alive = false; };
  }, [publicKey, slot]);

  const turnOn = async () => {
    if (!publicKey) return;
    acted.current = true;
    setBusy(true); setMessage(null);
    const r = await enablePush(publicKey, slot);
    setBusy(false);
    if (r.ok) { setState("on"); return; }
    if (r.reason === "denied") { setState("denied"); return; }
    setState("error"); setMessage(r.message);
  };
  const turnOff = async () => {
    acted.current = true;
    setBusy(true); setMessage(null);
    const ok = await disablePush(slot);
    setBusy(false);
    if (ok) setState("off"); else { setState("error"); setMessage("Could not turn notifications off. Please try again."); }
  };
  const notNow = () => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } setNotNowClicked(true); };

  if (compact) {
    if (state !== "off" && state !== "error") return null;
    if (dismissed && state === "off") return null;
  }
  if (state === "loading") return compact ? null : <p className="text-sm text-muted" role="status">Checking this device…</p>;

  return (
    <section aria-label="Push notifications on this device" data-testid="push-controls" data-state={state} className="card space-y-3 p-4">
      <p className="font-semibold">Push notifications on this device</p>
      {state === "unavailable" ? <p className="text-sm text-muted">Push notifications are temporarily unavailable. Your notifications still appear inside CampusConnect.</p> : null}
      {state === "unsupported" ? <p className="text-sm text-muted">This browser cannot receive push notifications{/iPhone|iPad/.test(typeof navigator === "undefined" ? "" : navigator.userAgent) ? " unless CampusConnect is added to the Home Screen (Share → Add to Home Screen) and opened from there" : ""}. Your notifications still appear inside CampusConnect.</p> : null}
      {state === "denied" ? <p className="text-sm text-muted">Notifications are blocked for this site in your browser. To turn them on, open the site settings (the lock or tune icon next to the address), allow Notifications, then reload this page. Your notifications still appear inside CampusConnect.</p> : null}
      {state === "off" || state === "error" ? <p className="text-sm text-muted">Get a short alert on this device when something needs your attention, even when CampusConnect is closed. Alerts never show names, companies, marks or packages.</p> : null}
      {state === "on" ? <p className="text-sm" role="status">Push notifications are <strong>on</strong> for this device.</p> : null}
      {message ? <p role="alert" className="text-sm text-danger">{message}</p> : null}
      <div className="flex flex-wrap gap-2">
        {state === "off" || state === "error" ? <button type="button" className={`${btn} bg-primary text-primary-foreground`} disabled={busy} onClick={turnOn}>{busy ? "Turning on…" : state === "error" ? "Try again" : "Turn on notifications"}</button> : null}
        {state === "on" ? <button type="button" className={`${btn} border border-border`} disabled={busy} onClick={turnOff}>{busy ? "Turning off…" : "Turn off on this device"}</button> : null}
        {compact && state === "off" ? <button type="button" className={`${btn} border border-border`} onClick={notNow}>Not now</button> : null}
      </div>
    </section>
  );
}

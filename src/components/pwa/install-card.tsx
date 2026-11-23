"use client";

import { useState, useSyncExternalStore } from "react";
import { usePwa } from "./pwa-provider";

const KEY = "cc-install-dismissed";
const QUIET_DAYS = 14;
const dismissedRecently = () => { try { const t = Number(localStorage.getItem(KEY)); return t > 0 && Date.now() - t < QUIET_DAYS * 86400_000; } catch { return false; } };

/**
 * "Install CampusConnect". `card` (portal shell): shown only when installing is actually possible here, never when already installed, and
 * not again for 14 days after "Later". `inline` (preferences): always explains how to install on this device, with the button when available.
 */
export function InstallCard({ variant = "card" }: { variant?: "card" | "inline" }) {
  const { canInstall, installed, iosManual, install } = usePwa();
  const [laterNow, setLaterNow] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Read from storage on the client only (the server render assumes "dismissed" so nothing flashes in and out).
  const dismissed = useSyncExternalStore(() => () => {}, dismissedRecently, () => true);
  const hidden = variant === "card" && (dismissed || laterNow);

  if (installed) return variant === "inline" ? <p className="text-sm text-muted">CampusConnect is installed on this device.</p> : null;
  const showHowTo = variant === "inline" && !canInstall && !iosManual;
  if (variant === "card" && (hidden || (!canInstall && !iosManual))) return null;

  const later = () => { try { localStorage.setItem(KEY, String(Date.now())); } catch { /* ignore */ } setLaterNow(true); };
  const onInstall = async () => {
    const r = await install();
    if (r === "dismissed") setNote("No problem. You can install it later from Notification preferences.");
    if (r === "unavailable") setNote("Your browser did not offer installation right now. Use its menu: Install app or Add to Home Screen.");
    if (r === "accepted") setNote(null);
  };

  return (
    <section aria-label="Install CampusConnect" data-testid="install-card" className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="space-y-1 text-sm">
        <p className="font-semibold">Install CampusConnect</p>
        {iosManual ? (
          <p className="text-muted">On iPhone or iPad: tap <strong>Share</strong> in Safari, then <strong>Add to Home Screen</strong>. It then opens like an app.</p>
        ) : showHowTo ? (
          <p className="text-muted">Use your browser&apos;s menu: <strong>Install app</strong> (Chrome, Edge) or <strong>Add to Home Screen</strong> (Android, Safari). It then opens in its own window.</p>
        ) : (
          <p className="text-muted">Open it from your home screen or desktop in its own window, without the browser around it.</p>
        )}
        {note ? <p role="status" className="text-muted">{note}</p> : null}
      </div>
      <div className="flex gap-2">
        {canInstall ? <button type="button" onClick={onInstall} className="inline-flex h-11 items-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Install</button> : null}
        {variant === "card" ? <button type="button" onClick={later} className="inline-flex h-11 items-center rounded-full border border-border px-5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Later</button> : null}
      </div>
    </section>
  );
}

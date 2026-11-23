"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";

type InstallChoice = "accepted" | "dismissed" | "unavailable";
type Ctx = {
  /** The browser offered its own install prompt (Chrome, Edge, Android browsers). */
  canInstall: boolean;
  /** Running as an installed app (standalone window / iOS home-screen app). */
  installed: boolean;
  /** iPhone/iPad Safari: no install prompt exists, so we explain Share → Add to Home Screen. */
  iosManual: boolean;
  install: () => Promise<InstallChoice>;
  updateReady: boolean;
  applyUpdate: () => void;
  registration: ServiceWorkerRegistration | null;
};
const PwaContext = createContext<Ctx | null>(null);
export const usePwa = () => useContext(PwaContext) ?? { canInstall: false, installed: false, iosManual: false, install: async () => "unavailable" as const, updateReady: false, applyUpdate: () => {}, registration: null };

type BeforeInstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

const isStandalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const subscribeDisplayMode = (cb: () => void) => {
  const mq = window.matchMedia("(display-mode: standalone)");
  mq.addEventListener?.("change", cb);
  return () => mq.removeEventListener?.("change", cb);
};
const isIosSafari = () => {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
};

/**
 * Registers the service worker (production only), captures the browser's install prompt, notices an installed app, and reports updates.
 * Mounted once in the root layout; the install card, the push controls and the update banner all read from it.
 */
export function PwaProvider({ children }: { children: ReactNode }) {
  const [canInstall, setCanInstall] = useState(false);
  const [justInstalled, setJustInstalled] = useState(false);
  // "Installed" and "iPhone Safari" are facts about the browser, read on the client only (false while rendering on the server).
  const standalone = useSyncExternalStore(subscribeDisplayMode, isStandalone, () => false);
  const ios = useSyncExternalStore(() => () => {}, isIosSafari, () => false);
  const installed = standalone || justInstalled;
  const iosManual = ios && !installed;
  const [updateReady, setUpdateReady] = useState(false);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const deferred = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); deferred.current = e as BeforeInstallPromptEvent; setCanInstall(true); };
    const onInstalled = () => { deferred.current = null; setCanInstall(false); setJustInstalled(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    let cancelled = false;
    let reloading = false;
    const onController = () => { if (!reloading && sessionStorageFlag()) { reloading = true; window.location.reload(); } };
    navigator.serviceWorker.addEventListener("controllerchange", onController);
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).then((reg) => {
      if (cancelled) return;
      setRegistration(reg);
      const watch = (w: ServiceWorker | null) => w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) setUpdateReady(true); });
      if (reg.waiting && navigator.serviceWorker.controller) setUpdateReady(true);
      reg.addEventListener("updatefound", () => watch(reg.installing));
      const check = () => reg.update().catch(() => {});
      const t = window.setInterval(check, 60 * 60 * 1000);
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") check(); });
      return () => window.clearInterval(t);
    }).catch(() => { /* a failed registration leaves the site working normally, just not installable/offline */ });
    return () => { cancelled = true; navigator.serviceWorker.removeEventListener("controllerchange", onController); };
  }, []);

  const install = useCallback(async (): Promise<InstallChoice> => {
    const e = deferred.current;
    if (!e) return "unavailable";
    deferred.current = null; setCanInstall(false);          // a prompt can be used once
    await e.prompt();
    const { outcome } = await e.userChoice;
    return outcome;
  }, []);

  const applyUpdate = useCallback(() => {
    try { sessionStorage.setItem("cc-sw-reload", "1"); } catch { /* ignore */ }
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
  }, [registration]);

  const value = useMemo(() => ({ canInstall, installed, iosManual, install, updateReady, applyUpdate, registration }), [canInstall, installed, iosManual, install, updateReady, applyUpdate, registration]);
  return (
    <PwaContext.Provider value={value}>
      {children}
      {updateReady ? (
        <div role="status" className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3 text-sm shadow-lg">
          <span>A new version of CampusConnect is ready.</span>
          <button type="button" onClick={applyUpdate} className="inline-flex h-11 shrink-0 items-center rounded-full bg-primary px-4 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Update</button>
        </div>
      ) : null}
    </PwaContext.Provider>
  );
}

function sessionStorageFlag() { try { const v = sessionStorage.getItem("cc-sw-reload") === "1"; sessionStorage.removeItem("cc-sw-reload"); return v; } catch { return false; } }

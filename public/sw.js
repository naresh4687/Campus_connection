/* CampusConnect service worker. No secrets live here (the VAPID public key comes from the page; the private key never leaves the server).
 *
 * Caching, deliberately tiny:
 *   - the offline page and its icon (precached at install);
 *   - build-hashed static files under /_next/static/ and /icons/ (public, identical for everyone, never user data).
 * Everything else (pages, API routes, downloads, anything with a cookie) goes straight to the network and is never stored, so nothing private
 * can be served to another person or after sign-out. Pages that cannot be reached show the offline page instead.
 */
const VERSION = "cc-sw-v1";
const SHELL = `${VERSION}-shell`;
const STATIC = `${VERSION}-static`;
const SHELL_FILES = ["/offline.html", "/offline.css", "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  // The new worker waits (the page offers "Update") instead of replacing the old one under an open page.
  event.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const k of await caches.keys()) if (!k.startsWith(VERSION)) await caches.delete(k);   // old versions
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  const d = event.data || {};
  if (d.type === "SKIP_WAITING") self.skipWaiting();
  if (d.type === "CLEAR_CACHES") event.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.endsWith("-static")).map((k) => caches.delete(k)))));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    event.respondWith(fetch(req).catch(async () => (await caches.match("/offline.html", { cacheName: SHELL })) || Response.error()));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith((async () => {
      const cache = await caches.open(STATIC);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && !res.headers.has("set-cookie")) cache.put(req, res.clone());
      return res;
    })());
  }
  // anything else: not intercepted
});

// A push carries only an id and generic words. The page it opens is built HERE from that id, never taken from the payload.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  const id = typeof data.id === "string" && UUID.test(data.id) ? data.id : null;
  const title = typeof data.title === "string" && data.title ? data.title.slice(0, 80) : "CampusConnect";
  const body = typeof data.body === "string" && data.body ? data.body.slice(0, 160) : "You have a new notification.";
  event.waitUntil(self.registration.showNotification(title, {
    body, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png",
    tag: id || "campusconnect", data: { id },   // same tag = a repeat replaces, never stacks
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data && event.notification.data.id;
  const path = typeof id === "string" && UUID.test(id) ? `/notifications/${id}/open` : "/app";   // the server checks the user owns it
  const target = new URL(path, self.location.origin).href;
  event.waitUntil((async () => {
    const wins = (await self.clients.matchAll({ type: "window", includeUncontrolled: true })).filter((w) => new URL(w.url).origin === self.location.origin);
    const win = wins.find((w) => w.focused) || wins.find((w) => w.visibilityState === "visible") || wins[0];
    if (win) {
      try { await win.focus(); await win.navigate(target); return; } catch (e) { /* fall through to a new window */ }
    }
    await self.clients.openWindow(target);
  })());
});

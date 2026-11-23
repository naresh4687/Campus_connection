import { expect, test, type Page } from "@playwright/test";
import { inspect } from "../db/tests/world";
import { loginAs, seed } from "./helpers";

// The browser's real push service (FCM and friends) is not reachable from a test run, so these tests replace ONLY PushManager.subscribe with a
// stand-in returning an allowed-looking endpoint and valid-looking keys. Everything else (permission UI, our API, database, sign-out) is real.
const P256 = "B" + "A".repeat(86), AUTHK = "A".repeat(22);
const fakePush = (page: Page, opts: { permission: "granted" | "denied" | "default"; endpoint?: string }) =>
  page.addInitScript(({ permission, endpoint, P256, AUTHK }) => {
    const buf = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0)).buffer;
    const FLAG = "e2e-push-sub";   // a real browser keeps its subscription across reloads; so does this stand-in
    const mk = () => ({ endpoint, options: { applicationServerKey: null as ArrayBuffer | null }, getKey: (n: string) => buf(n === "p256dh" ? P256 : AUTHK), unsubscribe: async () => { sessionStorage.removeItem(FLAG); return true; } });
    Object.defineProperty(Notification, "permission", { get: () => permission, configurable: true });
    Notification.requestPermission = async () => permission;
    PushManager.prototype.subscribe = async function (o: { applicationServerKey: BufferSource }) { const s = mk(); s.options.applicationServerKey = o.applicationServerKey as ArrayBuffer; sessionStorage.setItem(FLAG, "1"); sessionStorage.setItem(FLAG + "-key", btoa(String.fromCharCode(...new Uint8Array(o.applicationServerKey as ArrayBuffer)))); return s as unknown as PushSubscription; };
    PushManager.prototype.getSubscription = async () => { if (!sessionStorage.getItem(FLAG)) return null; const s = mk(); s.options.applicationServerKey = Uint8Array.from(atob(sessionStorage.getItem(FLAG + "-key") ?? ""), (c) => c.charCodeAt(0)).buffer; return s as unknown as PushSubscription; };
  }, { permission: opts.permission, endpoint: opts.endpoint ?? "https://fcm.googleapis.com/fcm/send/e2e-device", P256, AUTHK });

test.describe("installable app", () => {
  test("the manifest is valid, branded and its icons load", async ({ request }) => {
    const res = await request.get("/manifest.webmanifest");
    expect(res.status()).toBe(200);
    const m = await res.json();
    expect(m).toMatchObject({ name: "CampusConnect", short_name: "CampusConnect", display: "standalone", scope: "/", theme_color: "#101210", background_color: "#eef5e8" });
    expect(m.start_url).toMatch(/^\/app/); expect(m.description.length).toBeGreaterThan(20);
    const purposes = m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`);
    expect(purposes).toEqual(expect.arrayContaining(["192x192:any", "512x512:any", "512x512:maskable"]));
    for (const i of m.icons) { const r = await request.get(i.src); expect(r.status(), i.src).toBe(200); expect(r.headers()["content-type"]).toContain("image/png"); expect((await r.body()).length).toBeGreaterThan(500); }
    expect((await request.get("/icons/apple-touch-icon.png")).status()).toBe(200);
  });

  test("the page links the manifest and Apple home-screen metadata", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", /manifest\.webmanifest/);
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute("content", "#101210");
  });

  test("the service worker registers, is served uncached with whole-site scope, and shows the offline page when the network is gone", async ({ page, context }) => {
    const sw = await page.request.get("/sw.js");
    expect(sw.headers()["cache-control"]).toContain("no-cache"); expect(sw.headers()["service-worker-allowed"]).toBe("/");
    await page.goto("/features");
    const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
    expect(scope).toMatch(/\/$/);
    await context.setOffline(true);
    await page.goto("/features").catch(() => {});
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    await context.setOffline(false);
  });

  test("private pages are never cached, and signing out leaves nothing private behind", async ({ page, context }) => {
    await loginAs(page, "pwaStudent");
    await page.goto("/student"); await page.goto("/student/profile"); await page.goto("/notifications?as=student");
    await page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state);
    const cached = await page.evaluate(async () => { const out: string[] = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname); return out; });
    for (const p of cached) expect(p, p).toMatch(/^\/(_next\/static\/|icons\/|offline\.)/);
    expect(cached.some((p) => /^\/(student|college|placement|coordinator|platform|api|notifications|documents|evidence)/.test(p))).toBe(false);
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await context.setOffline(true);
    await page.goto("/student").catch(() => {});
    await expect(page.getByRole("heading", { name: "You are offline" })).toBeVisible();
    await expect(page.locator("body")).not.toContainText("Profile");
    await context.setOffline(false);
    const left = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (k) => (await (await caches.open(k)).keys()).map((r) => new URL(r.url).pathname)))).flat());
    expect(left.some((p) => /^\/(student|api|notifications)/.test(p))).toBe(false);
  });

  test("/app sends signed-out visitors to sign in and signed-in users to their own home", async ({ page }) => {
    await page.goto("/app?source=pwa"); await expect(page).toHaveURL(/\/login$/);
    await loginAs(page, "pwaStudent2"); await page.goto("/app?source=pwa"); await expect(page).toHaveURL(/\/student$/);
  });

  test("install card: appears only when the browser offers installation, installs, hides after Later, and never shows when already installed", async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __prompted: number }).__prompted = 0;
      window.addEventListener("load", () => setTimeout(() => {
        const e = new Event("beforeinstallprompt", { cancelable: true }) as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
        e.prompt = async () => { (window as unknown as { __prompted: number }).__prompted++; };
        e.userChoice = Promise.resolve({ outcome: "accepted" });
        window.dispatchEvent(e);
      }, 100));
    });
    await loginAs(page, "pwaOfficer");
    const card = page.getByTestId("install-card");
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Install" })).toBeVisible(); await expect(card.getByRole("button", { name: "Later" })).toBeVisible();
    await card.getByRole("button", { name: "Install" }).click();
    expect(await page.evaluate(() => (window as unknown as { __prompted: number }).__prompted)).toBe(1);
    await page.reload(); await expect(card).toBeVisible();
    await card.getByRole("button", { name: "Later" }).click(); await expect(card).toHaveCount(0);
    await page.reload(); await page.waitForTimeout(600); await expect(page.getByTestId("install-card")).toHaveCount(0);   // quiet for two weeks
  });

  test("an installed (standalone) app shows no install card", async ({ page }) => {
    await page.addInitScript(() => {
      const real = window.matchMedia.bind(window);
      window.matchMedia = (q: string) => (q.includes("display-mode: standalone") ? ({ matches: true, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false } as unknown as MediaQueryList) : real(q));
      window.addEventListener("load", () => setTimeout(() => { const e = new Event("beforeinstallprompt", { cancelable: true }); Object.assign(e, { prompt: async () => {}, userChoice: Promise.resolve({ outcome: "dismissed" }) }); window.dispatchEvent(e); }, 100));
    });
    await loginAs(page, "pwaOfficer"); await page.waitForTimeout(600);
    await expect(page.getByTestId("install-card")).toHaveCount(0);
    await page.goto("/notifications/preferences?as=placement"); await expect(page.getByText("CampusConnect is installed on this device.")).toBeVisible();
  });

  test("on iPhone Safari the card explains Share → Add to Home Screen instead of offering a button", async ({ browser }) => {
    const ctx = await browser.newContext({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1", viewport: { width: 390, height: 800 } });
    const page = await ctx.newPage();
    await loginAs(page, "pwaOfficer");
    const card = page.getByTestId("install-card");
    await expect(card).toBeVisible(); await expect(card).toContainText("Add to Home Screen"); await expect(card.getByRole("button", { name: "Install" })).toHaveCount(0);
    await ctx.close();
  });
});

test.describe("push subscriptions", () => {
  test("the API refuses anonymous callers, other origins and bad input", async ({ request, baseURL }) => {
    const body = { endpoint: "https://fcm.googleapis.com/fcm/send/x", keys: { p256dh: P256, auth: AUTHK } };
    const same = { origin: baseURL! };   // same-origin, so the refusal below is about being signed out, not the origin check
    expect((await request.post("/api/push/subscribe", { data: body })).status()).toBe(403);           // no origin evidence at all: refused first
    expect((await request.post("/api/push/subscribe", { data: body, headers: same })).status()).toBe(401);
    expect((await request.post("/api/push/unsubscribe", { data: { endpoint: body.endpoint }, headers: same })).status()).toBe(401);
    expect((await request.post("/api/push/status", { data: { endpoint: body.endpoint }, headers: same })).status()).toBe(401);
    expect((await request.post("/api/push/subscribe", { data: body, headers: { origin: "https://evil.example" } })).status()).toBe(403);
    expect((await request.post("/api/push/dispatch")).status()).toBe(404);
    expect((await request.post("/api/push/dispatch", { headers: { authorization: "Bearer wrong" } })).status()).toBe(404);
    expect((await request.get(`${baseURL}/api/push/dispatch`)).status()).toBe(404);
  });

  test("a signed-in user turns notifications on and off on this device; the server row belongs to them", async ({ page, context }) => {
    await context.grantPermissions(["notifications"]);
    await fakePush(page, { permission: "granted", endpoint: "https://fcm.googleapis.com/fcm/send/e2e-device-main" });
    await loginAs(page, "pwaStudent");
    await page.goto("/notifications/preferences?as=student");
    const box = page.getByTestId("push-controls");
    await expect(box).toHaveAttribute("data-state", "off");
    await box.getByRole("button", { name: "Turn on notifications" }).click();
    await expect(box).toHaveAttribute("data-state", "on");
    const me = seed().users.pwaStudent.toLowerCase();
    const rows = await inspect<{ active: boolean; email: string; device_label: string }>("SELECT s.active, lower(u.email::text) AS email, s.device_label FROM push_subscriptions s JOIN users u ON u.id = s.user_id WHERE s.endpoint = 'https://fcm.googleapis.com/fcm/send/e2e-device-main'");
    expect(rows).toEqual([{ active: true, email: me, device_label: expect.stringContaining("Chrome") }]);
    await page.reload();                                                           // still on after a refresh (the server remembers)
    await expect(page.getByTestId("push-controls")).toHaveAttribute("data-state", "on");
    await expect(page.getByRole("list", { name: "Devices with push alerts" }).getByRole("listitem")).toHaveCount(1);
    await expect(page.getByTestId("push-master")).toHaveText("on");
    await page.getByRole("button", { name: "Pause all devices" }).click(); await expect(page.getByTestId("push-master")).toHaveText("paused");
    await page.getByRole("button", { name: "Resume all devices" }).click(); await expect(page.getByTestId("push-master")).toHaveText("on");
    await page.getByTestId("push-controls").getByRole("button", { name: "Turn off on this device" }).click();
    await expect(page.getByTestId("push-controls")).toHaveAttribute("data-state", "off");
    expect((await inspect<{ active: boolean }>("SELECT active FROM push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/e2e-device-main'"))[0].active).toBe(false);
  });

  test("a refused permission is explained, never re-requested, and creates no subscription; in-app notifications still work", async ({ page }) => {
    await fakePush(page, { permission: "denied", endpoint: "https://fcm.googleapis.com/fcm/send/e2e-denied" });
    await loginAs(page, "pwaStudent2");
    await page.goto("/notifications/preferences?as=student");
    const box = page.getByTestId("push-controls");
    await expect(box).toHaveAttribute("data-state", "denied");
    await expect(box).toContainText("blocked"); await expect(box.getByRole("button", { name: /turn on/i })).toHaveCount(0);
    expect(await inspect("SELECT 1 FROM push_subscriptions WHERE endpoint LIKE '%e2e-denied%'")).toHaveLength(0);
    await page.goto("/notifications?as=student"); await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  });

  test("the permission prompt never appears on its own: loading pages does not ask", async ({ page }) => {
    await fakePush(page, { permission: "default" });
    await page.addInitScript(() => { (window as unknown as { __asked: number }).__asked = 0; const f = Notification.requestPermission; Notification.requestPermission = async () => { (window as unknown as { __asked: number }).__asked++; return f(); }; });
    await loginAs(page, "pwaStudent2"); await page.goto("/student"); await page.goto("/notifications?as=student"); await page.goto("/notifications/preferences?as=student");
    expect(await page.evaluate(() => (window as unknown as { __asked: number }).__asked)).toBe(0);
  });

  test("the invitation on the notifications page can be dismissed and stays dismissed", async ({ page }) => {
    await fakePush(page, { permission: "default" });
    await loginAs(page, "pwaStudent2"); await page.goto("/notifications?as=student");
    const box = page.getByTestId("push-controls"); await expect(box).toBeVisible();
    await box.getByRole("button", { name: "Not now" }).click(); await expect(box).toHaveCount(0);
    await page.reload(); await page.waitForTimeout(500); await expect(page.getByTestId("push-controls")).toHaveCount(0);
  });

  test("an unsupported browser gets an honest message, and the inbox still works", async ({ page }) => {
    await page.addInitScript(() => { delete (window as unknown as { PushManager?: unknown }).PushManager; });
    await loginAs(page, "pwaStudent2"); await page.goto("/notifications/preferences?as=student");
    await expect(page.getByTestId("push-controls")).toHaveAttribute("data-state", "unsupported");
    await expect(page.getByTestId("push-controls")).toContainText("cannot receive push");
  });

  test("a platform administrator has no push controls (they belong to a college)", async ({ page }) => {
    await loginAs(page, "platform"); await page.goto("/notifications/preferences?as=platform");
    await expect(page.getByTestId("push-controls")).toHaveCount(0);
  });
});

test.describe("no email actions are offered anywhere (email is not available)", () => {
  const FORBIDDEN = /send (an )?e-?mail|e-?mail (sent|delivered|queued|status|notification|verification|reminder)|resend|verification e-?mail|reset e-?mail|notify (via|by) e-?mail|invitation e-?mail/i;
  test("signed-out and signed-in screens carry no email action or fake email status", async ({ page }) => {
    for (const p of ["/login", "/forgot-password", "/features", "/how-it-works", "/apply", "/contact"]) {
      await page.goto(p);
      // the one sentence that honestly says email is unavailable is allowed; anything else mentioning email actions is not
      const text = (await page.locator("body").innerText()).replace("so no reset email can be sent", "");
      expect(text.match(FORBIDDEN)?.[0] ?? null, p).toBeNull();
      await expect(page.getByRole("button", { name: FORBIDDEN })).toHaveCount(0); await expect(page.getByRole("link", { name: FORBIDDEN })).toHaveCount(0);
    }
    await loginAs(page, "pwaAdmin");
    for (const p of ["/college", "/college/staff", "/college/students", "/college/students/new", "/notifications/preferences?as=college", "/account"]) {
      await page.goto(p);
      const text = await page.locator("body").innerText();
      expect(text.match(FORBIDDEN)?.[0] ?? null, p).toBeNull();
      await expect(page.getByRole("button", { name: FORBIDDEN })).toHaveCount(0);
    }
  });
  test("the invitation workflow works without email: a one-time link is created, shown with a working Copy action, and no email is claimed", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await loginAs(page, "pwaAdmin");
    await page.goto("/college/staff");
    await page.locator("input#email").fill("invited.officer@pwa.example.test"); await page.locator("select#role").selectOption("PLACEMENT_OFFICER");
    await page.getByRole("button", { name: "Create invitation" }).click();
    const panel = page.getByTestId("invite-link-panel"); await expect(panel).toBeVisible();
    const link = await panel.getByLabel("One-time link").inputValue();
    expect(link).toMatch(/\/accept-invite\?token=/);
    await expect(panel).toContainText("Share this link"); await expect(panel).not.toContainText(/email delivery|sent by email/i);
    await panel.getByRole("button", { name: /copy/i }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  });
  test("forgot password is honest: it does not pretend to send anything", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByText("Email delivery is not enabled")).toBeVisible();
    await expect(page.getByRole("button", { name: /send|reset|submit/i })).toHaveCount(0);
  });
  test("preferences list only categories that really exist; no email controls", async ({ page }) => {
    await loginAs(page, "pwaStudent"); await page.goto("/notifications/preferences?as=student");
    await expect(page.getByLabel(/e-?mail/i)).toHaveCount(0);
    await expect(page.getByText(/notifications appear inside campusconnect/i)).toBeVisible();
  });
});

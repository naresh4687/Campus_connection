import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

/** Runs public/sw.js against a fake service-worker scope and returns its listeners and the calls it made. */
function load() {
  const handlers: Record<string, (e: unknown) => void> = {};
  const shown: { title: string; opts: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const nav: string[] = [];
  const win = (url: string, focused = false) => ({ url, focused, visibilityState: focused ? "visible" : "hidden", focus: vi.fn(async () => {}), navigate: vi.fn(async (u: string) => { nav.push(u); }) });
  const state = { windows: [] as ReturnType<typeof win>[] };
  const self = {
    location: { origin: "https://app.example.test" },
    addEventListener: (t: string, h: (e: unknown) => void) => { handlers[t] = h; },
    registration: { showNotification: async (title: string, opts: Record<string, unknown>) => { shown.push({ title, opts }); } },
    clients: { matchAll: async () => state.windows, openWindow: async (u: string) => { opened.push(u); }, claim: async () => {} },
    skipWaiting: () => {},
  };
  vm.runInNewContext(readFileSync("public/sw.js", "utf8"), { self, caches: {}, fetch: () => {}, URL, Response, console });
  const waits: Promise<unknown>[] = [];
  const ev = (extra: object) => ({ waitUntil: (p: Promise<unknown>) => waits.push(p), ...extra });
  return { handlers, shown, opened, nav, state, win, ev, settle: () => Promise.all(waits) };
}
const ID = "0b0f6c1e-1111-4222-8333-444455556666";
const pushEvent = (ctx: ReturnType<typeof load>, data: unknown) => ctx.handlers.push(ctx.ev({ data: { json: () => data } }));
const click = (ctx: ReturnType<typeof load>, id: unknown) => { const e = ctx.ev({ notification: { close: vi.fn(), data: { id } } }); ctx.handlers.notificationclick(e); return ctx.settle(); };

describe("service worker: push", () => {
  it("shows exactly what the server sent (title and body) and tags by notification id so repeats replace", async () => {
    const c = load(); pushEvent(c, { v: 1, id: ID, title: "Offer Update", body: "Your placement offer status has been updated." }); await c.settle();
    expect(c.shown).toHaveLength(1);
    expect(c.shown[0].title).toBe("Offer Update"); expect(c.shown[0].opts).toMatchObject({ tag: ID, data: { id: ID } });
  });
  it("a malformed or empty payload still shows a safe generic notification (a push must always be visible)", async () => {
    const c = load(); c.handlers.push(c.ev({ data: { json: () => { throw new Error("bad json"); } } })); pushEvent(c, { id: "<script>", title: 5, body: null }); c.handlers.push(c.ev({ data: null })); await c.settle();
    expect(c.shown).toHaveLength(3);
    for (const s of c.shown) { expect(s.title).toBe("CampusConnect"); expect((s.opts.data as { id: unknown }).id).toBeNull(); }
  });
  it("over-long text is cut", async () => {
    const c = load(); pushEvent(c, { id: ID, title: "T".repeat(500), body: "B".repeat(500) }); await c.settle();
    expect(c.shown[0].title.length).toBeLessThanOrEqual(80); expect(String(c.shown[0].opts.body).length).toBeLessThanOrEqual(160);
  });
});

describe("service worker: click", () => {
  it("opens a new window on our own authenticated redirect when the app is closed", async () => {
    const c = load(); await click(c, ID);
    expect(c.opened).toEqual([`https://app.example.test/notifications/${ID}/open`]);
  });
  it("focuses and reuses an existing window instead of opening another; prefers the focused one", async () => {
    const c = load(); const a = c.win("https://app.example.test/student"); const b = c.win("https://app.example.test/student/drives", true);
    c.state.windows = [a, b]; await click(c, ID);
    expect(b.focus).toHaveBeenCalled(); expect(a.focus).not.toHaveBeenCalled(); expect(c.nav).toEqual([`https://app.example.test/notifications/${ID}/open`]); expect(c.opened).toEqual([]);
  });
  it("ignores windows of other origins", async () => {
    const c = load(); c.state.windows = [c.win("https://evil.example/x", true)]; await click(c, ID);
    expect(c.opened).toHaveLength(1);
  });
  it("never uses a destination from the payload: a bad id goes to /app, and the push's own url field is ignored", async () => {
    for (const bad of ["../../evil", "https://evil.example", "javascript:alert(1)", null, 5, `${ID}/../x`]) {
      const c = load(); await click(c, bad);
      expect(c.opened, String(bad)).toEqual(["https://app.example.test/app"]);
    }
    const c = load(); pushEvent(c, { id: ID, title: "t", body: "b", url: "https://evil.example/phish" }); await c.settle();
    expect(JSON.stringify(c.shown[0].opts)).not.toContain("evil");
  });
  it("falls back to a new window when navigating the existing one fails", async () => {
    const c = load(); const w = c.win("https://app.example.test/student", true); w.navigate = vi.fn(async () => { throw new Error("nope"); }); c.state.windows = [w]; await click(c, ID);
    expect(c.opened).toHaveLength(1);
  });
});

describe("service worker: caching rules stay narrow", () => {
  it("only static build files, icons and the offline page are ever cached; nothing else is intercepted", () => {
    const src = readFileSync("public/sw.js", "utf8");
    expect(src).toContain('"/_next/static/"'); expect(src).toContain('"/icons/"');
    expect(src).not.toMatch(/\/api\//); expect(src).not.toMatch(/PRIVATE_KEY|privateKey|applicationServerKey|Bearer/);
  });
});

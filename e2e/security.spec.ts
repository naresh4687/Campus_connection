import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { loginAs } from "./helpers";

const nonceOf = (csp: string) => /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";

test.describe("security headers and CSP", () => {
  const cases: [string, string][] = [["public home", "/"], ["login", "/login"], ["not found", "/this-page-does-not-exist"], ["health route", "/api/health"]];
  for (const [name, path] of cases) {
    test(`${name}: strict CSP, security headers, and every script carries the page's nonce`, async ({ request }) => {
      const res = await request.get(path, { failOnStatusCode: false });
      const h = res.headers();
      const csp = h["content-security-policy"];
      expect(csp, "CSP header").toBeTruthy();
      const script = csp.split("; ").find((d) => d.startsWith("script-src"))!;
      expect(script).toMatch(/'nonce-[^']+'/); expect(script).toContain("'strict-dynamic'");
      expect(script).not.toContain("unsafe-inline"); expect(script).not.toContain("unsafe-eval");
      for (const d of ["default-src 'self'", "object-src 'none'", "frame-ancestors 'none'", "base-uri 'self'", "form-action 'self'"]) expect(csp.split("; ")).toContain(d);
      expect(csp).not.toContain("upgrade-insecure-requests");                       // this test server is plain http by design
      expect(h["x-content-type-options"]).toBe("nosniff"); expect(h["x-frame-options"]).toBe("DENY"); expect(h["referrer-policy"]).toBe("no-referrer");
      expect(h["strict-transport-security"]).toContain("max-age="); expect(h["permissions-policy"]).toContain("camera=()");
      expect(h["x-powered-by"]).toBeUndefined();
      if ((h["content-type"] ?? "").includes("text/html")) {
        const nonce = nonceOf(csp);
        const tags = (await res.text()).match(/<script\b[^>]*>/g) ?? [];
        expect(tags.length).toBeGreaterThan(0);
        for (const t of tags) expect(t, `script tag without the nonce: ${t.slice(0, 100)}`).toContain(`nonce="${nonce}"`);
      }
    });
  }
  test("the nonce is different on every request", async ({ request }) => {
    const a = nonceOf((await request.get("/login")).headers()["content-security-policy"]); const b = nonceOf((await request.get("/login")).headers()["content-security-policy"]);
    expect(a).not.toBe(""); expect(a).not.toBe(b);
  });
});

test.describe.serial("the strict CSP breaks nothing: a tour of every role's pages produces no violations", () => {
  const violations: string[] = [];
  async function tour(browser: Browser, who: string | null, paths: string[]) {
    const page = await (await browser.newContext()).newPage();
    page.on("console", (m) => { if (/Content Security Policy|Refused to (load|execute|apply|connect)/i.test(m.text())) violations.push(`${who ?? "anonymous"} ${page.url()}: ${m.text().slice(0, 200)}`); });
    page.on("pageerror", (e) => violations.push(`${who ?? "anonymous"} pageerror ${page.url()}: ${e.message.slice(0, 200)}`));
    if (who) await loginAs(page, who);
    for (const p of paths) { await page.goto(p); await page.waitForLoadState("networkidle"); }
    return page;
  }
  test("anonymous visitors", async ({ browser }) => { await tour(browser, null, ["/", "/features", "/how-it-works", "/apply", "/contact", "/privacy", "/terms", "/login"]); expect(violations).toEqual([]); });
  test("student", async ({ browser }) => { await tour(browser, "ntfA", ["/student", "/student/drives", "/student/offers", "/student/academics", "/student/documents", "/student/profile", "/notifications", "/notifications/preferences", "/account"]); expect(violations).toEqual([]); });
  test("placement officer, including the drive form with the AI panel and the chart page", async ({ browser }) => {
    const page = await tour(browser, "rptOfficer", ["/placement", "/placement/companies", "/placement/drives", "/placement/drives/new", "/placement/placements", "/placement/reports"]);
    expect(violations).toEqual([]);
    const widths = await page.locator("svg rect.fill-primary").evaluateAll((els) => els.map((e) => (e as SVGRectElement).getBoundingClientRect().width));
    expect(widths.length).toBeGreaterThan(0); expect(Math.max(...widths), "chart bars are drawn (no inline styles needed)").toBeGreaterThan(2);
  });
  test("college administrator", async ({ browser }) => { await tour(browser, "rptAdmin", ["/college", "/college/reports", "/college/placements", "/college/audit", "/college/students"]); expect(violations).toEqual([]); });
  test("coordinator", async ({ browser }) => { await tour(browser, "regCoord", ["/coordinator", "/coordinator/verification", "/coordinator/documents"]); expect(violations).toEqual([]); });
});

test.describe("sessions, origins and probing", () => {
  test("the session cookie is HttpOnly, SameSite and scoped to the whole site", async ({ browser }) => {
    const ctx = await browser.newContext(); const page = await ctx.newPage(); await loginAs(page, "ntfA");
    const cookies = await ctx.cookies();
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) { expect(c.httpOnly, c.name).toBe(true); expect(["Lax", "Strict"], c.name).toContain(c.sameSite); expect(c.path).toBe("/"); expect(c.domain).not.toMatch(/^\./); }
    await ctx.close();
  });
  test("file-upload endpoints refuse foreign origins and callers without the right role", async ({ browser }) => {
    const id = randomUUID(); const drive = randomUUID();
    const student = await (await browser.newContext()).newPage(); await loginAs(student, "ntfA");
    const body = { multipart: { file: { name: "a.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\n%%EOF\n") } } };
    expect((await student.request.post(`/student/offers/${id}/proof`, { ...body, headers: { Origin: "https://evil.example" }, failOnStatusCode: false })).status()).toBe(403);
    expect((await student.request.post(`/placement/offers/${id}/letter?drive=${drive}`, { ...body, failOnStatusCode: false })).status()).toBe(403);          // a student cannot upload offer letters
    const anon = await (await browser.newContext()).request.post(`/student/offers/${id}/proof`, { ...body, failOnStatusCode: false });
    expect(anon.status()).toBe(403);
    const unknown = await student.request.post(`/student/offers/${id}/proof`, { ...body, failOnStatusCode: false });
    expect([404, 403]).toContain(unknown.status());                                                                                                        // an offer that is not theirs
    await student.context().close();
  });
  test("sensitive files and debug endpoints are not served", async ({ request }) => {
    for (const p of ["/.env", "/.git/config", "/package.json", "/db/migrations/0001_baseline.sql", "/e2e/.seed.json", "/src/server/config.ts", "/api/debug", "/_next/../package.json", "/.next/server/app/page.js"]) {
      const r = await request.get(p, { failOnStatusCode: false });
      expect(r.status(), p).toBe(404);
      expect(await r.text(), p).not.toMatch(/DATABASE_URL|AUTH_PEPPER|cc_owner|BEGIN (RSA )?PRIVATE KEY/);
    }
  });
  test("an unknown or foreign identifier is a plain 404, never a stack trace", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage(); await loginAs(page, "rptOfficer");
    for (const p of [`/placement/drives/${randomUUID()}`, `/placement/drives/${randomUUID()}/offers`, "/placement/drives/not-a-uuid", `/placement/companies/${randomUUID()}`]) {
      const r = await page.goto(p);
      expect(r?.status(), p).toBe(404);
      expect(await page.content(), p).not.toMatch(/at \S+ \(.*\.(js|ts):\d+|node_modules|ECONNREFUSED|syntax error at|relation ".*" does not exist/);
    }
    await page.context().close();
  });
});

test.describe.serial("authorization sweep: every role against every other role's area", () => {
  const AREAS: Record<string, string[]> = {
    platform: ["/platform", "/platform/applications", "/platform/colleges", "/platform/audit"],
    college: ["/college", "/college/students", "/college/staff", "/college/reports", "/college/placements", "/college/audit"],
    placement: ["/placement", "/placement/companies", "/placement/drives", "/placement/placements", "/placement/reports"],
    coordinator: ["/coordinator", "/coordinator/verification", "/coordinator/documents"],
    student: ["/student", "/student/drives", "/student/offers", "/student/academics", "/student/documents"],
  };
  const ACTORS: [string, string][] = [["ntfA", "student"], ["rptOfficer", "placement"], ["rptAdmin", "college"], ["regCoord", "coordinator"]];
  for (const [who, own] of ACTORS) {
    test(`${who} (${own}) cannot open any other role's pages`, async ({ browser }) => {
      const page: Page = await (await browser.newContext()).newPage(); await loginAs(page, who);
      for (const [area, paths] of Object.entries(AREAS)) {
        if (area === own) continue;
        for (const p of paths) {
          const r = await page.goto(p, { waitUntil: "domcontentloaded" });
          const landed = new URL(page.url()).pathname;
          expect(landed !== p || r?.status() === 404 || r?.status() === 403, `${who} must not render ${p} (landed on ${landed}, status ${r?.status()})`).toBe(true);
          if (landed === p) expect([403, 404]).toContain(r?.status());
        }
      }
      await page.context().close();
    });
  }
  test("anonymous visitors are sent to sign in for every protected area", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    for (const paths of Object.values(AREAS)) for (const p of paths) {
      await page.goto(p, { waitUntil: "domcontentloaded" });
      expect(new URL(page.url()).pathname, p).toBe("/login");
    }
    for (const p of ["/notifications", "/account"]) { await page.goto(p, { waitUntil: "domcontentloaded" }); expect(new URL(page.url()).pathname, p).toBe("/login"); }
    const api = await page.request.get("/reports/export/placed", { failOnStatusCode: false }); expect(api.status()).toBe(401);
    const doc = await page.request.get(`/documents/${randomUUID()}/download`, { failOnStatusCode: false, maxRedirects: 0 }); expect([303, 401, 403, 404]).toContain(doc.status());
    await page.context().close();
  });
});

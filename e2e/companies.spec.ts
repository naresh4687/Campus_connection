import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { sql } from "kysely";
import { withTenantTx } from "../src/server/db";
import { appDb, inspect } from "../db/tests/world";
import { expectOn, formAlert, loginAs, expectOnSignIn } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const settle = async (p: Page) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(300); };
const stat = async (p: Page, id: string) => Number(await p.getByTestId(`stat-${id}`).innerText());

test.describe.serial("companies", () => {
  let officer: Page; let admin: Page;
  const open: Page[] = [];
  let acmeUrl = "";
  const newPage = async (b: Browser) => { const p = await (await b.newContext()).newPage(); open.push(p); return p; };
  const fill = async (p: Page, v: Record<string, string>) => {
    const labels: Record<string, string> = { name: "Company name", website: "Website (optional)", industry: "Industry (optional)", location: "Location (optional)", description: "Description (optional)", person: "Contact person (optional)", email: "Contact email (optional)", phone: "Contact phone (optional)" };
    for (const [k, val] of Object.entries(v)) await p.getByLabel(labels[k], { exact: true }).fill(val);
  };

  test.beforeAll(async ({ browser }) => { officer = await newPage(browser); await loginAs(officer, "officerA"); admin = await newPage(browser); await loginAs(admin, "adminA"); });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("the officer's home starts empty and points to adding a company", async () => {
    await officer.goto("/placement");
    await expect(officer.getByRole("heading", { name: "Placement overview" })).toBeVisible();
    await officer.goto("/placement/companies");                                              // the totals live at the top of the Companies page
    expect(await stat(officer, "Companies")).toBe(0);
    await expect(officer.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Companies" })).toBeVisible();
    await officer.goto("/placement");
    await officer.getByRole("link", { name: "Add your first company" }).click();
    await expectOn(officer, "/placement/companies/new");
  });

  test("adding a company: validation, kept values, creation, case-insensitive duplicates, hostile text", async () => {
    await officer.getByRole("button", { name: "Add company" }).click(); await settle(officer);
    await expect(officer.locator("#name-error")).toBeVisible();
    await fill(officer, { name: "Acme Technologies", website: "javascript:alert(1)", email: "not-an-email", phone: "abc", location: "Bengaluru" });
    await officer.getByRole("button", { name: "Add company" }).click(); await settle(officer);
    for (const f of ["website", "contactEmail", "contactPhone"]) await expect(officer.locator(`#${f}-error`)).toBeVisible();
    await expect(officer.getByLabel("Company name")).toHaveValue("Acme Technologies");
    await fill(officer, { website: "https://acme.example.test", email: "Hiring@Acme.Example.Test", phone: "+91 98765 43210", industry: "Information Technology", person: "Ravi Recruiter", description: "Builds <b>things</b> & <script>window.__x=1</script>" });
    await officer.getByRole("button", { name: "Add company" }).click();
    await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}\?created=1$/);
    acmeUrl = officer.url().split("?")[0];
    await expect(officer.getByText("Company added.")).toBeVisible();
    await expect(officer.getByRole("heading", { name: "Acme Technologies" })).toBeVisible();
    await expect(officer.getByLabel("Contact email (optional)")).toHaveValue("hiring@acme.example.test");    // normalised
    expect(await officer.evaluate(() => (window as unknown as { __x?: number }).__x)).toBeUndefined();         // description is text, never markup

    await officer.goto("/placement/companies/new");
    await fill(officer, { name: "ACME technologies" });
    await officer.getByRole("button", { name: "Add company" }).click();
    await expect(formAlert(officer)).toContainText("already exists");
  });

  test("editing records exactly what changed; saving nothing new adds no history; deactivate/reactivate are tracked", async () => {
    await officer.goto(acmeUrl);
    await officer.getByLabel("Location (optional)").fill("Pune");
    await officer.getByLabel("Contact phone (optional)").fill("+91 90000 11111");
    await officer.getByRole("button", { name: "Save changes" }).click();
    await expect(officer.getByText("Company saved.")).toBeVisible();
    await officer.reload();
    await expect(officer.getByLabel("Location (optional)")).toHaveValue("Pune");
    await expect(officer.getByRole("list", { name: "Company history" })).toContainText("Changed: contact phone, location");
    const before = await officer.getByRole("list", { name: "Company history" }).getByRole("listitem").count();
    await officer.getByRole("button", { name: "Save changes" }).click(); await settle(officer);
    await officer.reload();
    expect(await officer.getByRole("list", { name: "Company history" }).getByRole("listitem").count()).toBe(before);

    await officer.getByRole("button", { name: "Deactivate company" }).click();
    await expect(officer.getByText("Company deactivated.")).toBeVisible();
    await expect(officer.getByText("cannot be used for new drives")).toBeVisible();
    await officer.getByRole("button", { name: "Reactivate company" }).click();
    await expect(officer.getByText("Company reactivated.")).toBeVisible();
    await officer.reload();
    const hist = officer.getByRole("list", { name: "Company history" });
    for (const e of ["Created", "Updated", "Deactivated", "Reactivated"]) await expect(hist).toContainText(e);
    await expect(hist).toContainText("Test officerA");
  });

  test("search, filters and pagination on a populated list (wildcards are literal)", async () => {
    const [u] = await inspect<{ id: string }>("SELECT id FROM users WHERE email = 'officera@e2e.test'");
    const actor = { userId: u.id, collegeId: (await inspect<{ college_id: string }>("SELECT college_id FROM users WHERE id = $1", [u.id]))[0].college_id, role: "PLACEMENT_OFFICER" as const };
    for (let i = 1; i <= 17; i++) await withTenantTx(actor, (t) => sql`SELECT placement.create_company(${`Bulk Company ${String(i).padStart(2, "0")}`}, null, ${i % 2 ? "Manufacturing" : "Banking & Finance"}, null, null, null, null, ${i % 3 ? "Chennai" : "Mumbai"})`.execute(t), appDb());
    await officer.goto("/placement/companies");
    await expect(officer.getByRole("row")).toHaveCount(16);
    await expect(officer.getByTestId("page-summary")).toContainText("Showing 1–15 of 18");
    await officer.getByRole("link", { name: "Next" }).click();
    await expect(officer.getByTestId("page-summary")).toContainText("Showing 16–18 of 18");
    await officer.goto("/placement/companies?q=bulk%20company%2007");
    await expect(officer.getByRole("row")).toHaveCount(2);
    await officer.goto("/placement/companies?q=mumbai");
    await expect(officer.getByTestId("page-summary")).toContainText("of 5");
    await officer.goto("/placement/companies?industry=Manufacturing");
    await expect(officer.getByTestId("page-summary")).toContainText("of 9");
    await officer.goto("/placement/companies?q=100%25_%5C");
    await expect(officer.getByText("No companies found")).toBeVisible();
    await officer.goto("/placement/companies?status=INACTIVE");
    await expect(officer.getByText("No companies found")).toBeVisible();
    await officer.goto("/placement/companies");
    expect(await stat(officer, "Companies")).toBe(18);
  });

  test("a college admin has read-only oversight; other roles are locked out", async ({ browser }) => {
    await admin.goto("/college/companies");
    await expect(admin.getByRole("row", { name: /Acme Technologies/ })).toBeVisible();
    await expect(admin.getByRole("link", { name: "Add company" })).toHaveCount(0);
    await admin.getByRole("link", { name: "Acme Technologies" }).click();
    await expect(admin.getByRole("heading", { name: "Acme Technologies" })).toBeVisible();
    await expect(admin.getByRole("button", { name: /Save|Deactivate|Reactivate/ })).toHaveCount(0);
    await expect(admin.getByRole("link", { name: "https://acme.example.test" })).toHaveAttribute("rel", /noopener/);
    await expect(admin.getByRole("link", { name: "hiring@acme.example.test" })).toHaveAttribute("href", /^mailto:/);
    await expect(admin.getByText("Builds <b>things</b>")).toBeVisible();
    for (const path of ["/placement", "/placement/companies", acmeUrl.replace("http://127.0.0.1:3100", "")]) { await admin.goto(path); await expectOnSignIn(admin, "college"); }   // each role has its own session: another role's pages ask for that sign-in
    await officer.goto("/college/companies"); await expectOnSignIn(officer, "college");
    for (const key of ["studentX", "coordA"]) {
      const p = await newPage(browser); await loginAs(p, key);
      const home = p.url();
      for (const path of ["/placement/companies", "/college/companies"]) { await p.goto(path); await expectOnSignIn(p, "college"); void home; }   // a student is asked to sign in as staff
    }
  });

  test("another college sees none of this college's companies and gets 404 for their pages", async ({ browser }) => {
    const b = await newPage(browser); await loginAs(b, "officerB");
    await b.goto("/placement/companies");
    await expect(b.getByText("No companies found")).toBeVisible();
    expect((await b.goto(acmeUrl.replace("http://127.0.0.1:3100", "")))?.status()).toBe(404);
    await b.goto("/placement/companies");
    expect(await stat(b, "Companies")).toBe(0);
    const ab = await newPage(browser); await loginAs(ab, "adminB");
    await ab.goto("/college/companies");
    await expect(ab.getByText("No companies found")).toBeVisible();
    expect((await ab.goto(acmeUrl.replace("http://127.0.0.1:3100", "").replace("/placement/", "/college/")))?.status()).toBe(404);
  });

  test("company pages pass the automated accessibility scan and fit a phone screen", async () => {
    const targets: [Page, string[]][] = [[officer, ["/placement", "/placement/companies", "/placement/companies/new", acmeUrl.replace("http://127.0.0.1:3100", "")]], [admin, ["/college/companies"]]];
    for (const [page, paths] of targets) for (const path of paths) {
      await page.goto(path); await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), path).toEqual([]);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(path); await page.waitForLoadState("networkidle");
      const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(o.scroll, `${path} scrollWidth`).toBeLessThanOrEqual(o.inner);
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });
});

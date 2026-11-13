import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const num = async (p: Page, label: string) => Number(await p.getByTestId(`stat-${label}`).innerText());
const funnelOf = async (p: Page) => {
  const out: Record<string, number> = {};
  for (const k of ["Selected", "Offers issued", "Offers accepted", "Joining recorded", "Verified placements"]) out[k] = Number(await p.getByLabel("Placement funnel").locator("div", { hasText: new RegExp(`^${k}`) }).locator("dd").innerText());
  return out;
};
const noSideScroll = async (page: Page, path: string) => {
  await page.goto(path); await page.waitForLoadState("networkidle");
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(o.scroll, `${path} scrollWidth ${o.scroll} > ${o.inner}`).toBeLessThanOrEqual(o.inner);
};

test.describe.serial("role dashboards show real numbers that reconcile with the detail pages", () => {
  let officer: Page; let admin: Page; let coord: Page; let student: Page;
  const open: Page[] = [];
  const newPage = async (b: Browser, who: string, viewport?: { width: number; height: number }) => { const c = await b.newContext(viewport ? { viewport } : {}); const p = await c.newPage(); open.push(p); await loginAs(p, who); return p; };
  test.beforeAll(async ({ browser }) => {
    officer = await newPage(browser, "offerOfficer"); admin = await newPage(browser, "regAdmin"); coord = await newPage(browser, "regCoord"); student = await newPage(browser, "offA");
  });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("officer: the funnel and drive counts on the home page equal the detail pages", async () => {
    await officer.goto("/placement");
    await expect(officer.getByRole("heading", { name: "Placement overview" })).toBeVisible();
    const home = await funnelOf(officer);
    expect(home["Selected"]).toBeGreaterThanOrEqual(2);                       // the offers spec selected two students
    expect(home["Verified placements"]).toBeLessThanOrEqual(home["Offers accepted"]);   // a placement needs an accepted offer
    expect(home["Offers accepted"]).toBeLessThanOrEqual(home["Offers issued"]);
    expect(home["Offers issued"]).toBeLessThanOrEqual(home["Selected"]);
    const tiles = { Draft: await num(officer, "Draft drives"), Published: await num(officer, "Published drives"), Closed: await num(officer, "Closed drives"), Archived: await num(officer, "Archived drives") };
    await officer.goto("/placement/placements");
    expect(await funnelOf(officer)).toEqual(home);
    await officer.goto("/placement/drives");
    const chip = async (label: string) => Number((await officer.getByLabel("Status counts").getByRole("link", { name: new RegExp(`^${label} \\(`) }).innerText()).match(/\((\d+)\)/)![1]);
    for (const [k, v] of Object.entries(tiles)) expect(await chip(k), k).toBe(v);
  });

  test("administrator: the same funnel (one source of truth) and drive counts as the detail pages", async () => {
    await admin.goto("/college");
    const adminFunnel = await funnelOf(admin);
    await officer.goto("/placement"); expect(await funnelOf(officer)).toEqual(adminFunnel);
    const published = await num(admin, "Published drives"); const closed = await num(admin, "Closed drives");
    await admin.goto("/college/drives");
    const chip = async (label: string) => Number((await admin.getByLabel("Status counts").getByRole("link", { name: new RegExp(`^${label} \\(`) }).innerText()).match(/\((\d+)\)/)![1]);
    expect(await chip("Published")).toBe(published); expect(await chip("Closed")).toBe(closed);
  });

  test("coordinator: participation counts are scoped numbers, consistent with each other", async () => {
    await coord.goto("/coordinator");
    await expect(coord.getByRole("heading", { name: "Drive participation in your departments" })).toBeVisible();
    const regs = await num(coord, "Active registrations"); const studs = await num(coord, "Students registered"); const drives = await num(coord, "Drives with your students");
    expect(studs).toBeLessThanOrEqual(regs); expect(drives).toBeLessThanOrEqual(regs);
    expect(Number.isInteger(regs) && regs >= 0).toBe(true);
  });

  test("student: the summary matches the offers list; nothing to respond to once the offer was withdrawn", async () => {
    await student.goto("/student");
    const summary = await student.getByTestId("drive-summary").innerText();
    const m = summary.match(/(\d+) open drives? · (\d+) registered · (\d+) offers?/);
    expect(m, summary).not.toBeNull();
    await student.goto("/student/offers");
    expect(await student.getByRole("row").count() - 1).toBe(Number(m![3]));
    await student.goto("/student");
    // the offer was withdrawn, so there is nothing to respond to (other items, such as open drives, may legitimately be listed)
    await expect(student.getByRole("list", { name: "Needs your attention" })).not.toContainText("Respond to your offer");
  });

  test("home pages pass the automated accessibility scan", async () => {
    for (const [p, url] of [[officer, "/placement"], [admin, "/college"], [coord, "/coordinator"], [student, "/student"]] as [Page, string][]) {
      await p.goto(url);
      const a11y = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
      expect(a11y.violations.map((v) => `${url}: ${v.id} ${v.nodes.length}`)).toEqual([]);
    }
  });
});

for (const width of [360, 768]) {
  test.describe(`placement pages at ${width}px wide do not scroll sideways`, () => {
    test.use({ viewport: { width, height: 800 } });
    test("officer", async ({ page }) => { await loginAs(page, "offerOfficer"); for (const p of ["/placement", "/placement/drives", "/placement/placements", "/placement/companies"]) await noSideScroll(page, p); });
    test("student", async ({ page }) => { await loginAs(page, "offB"); for (const p of ["/student", "/student/drives", "/student/offers"]) await noSideScroll(page, p); });
    test("administrator and coordinator", async ({ page }) => {
      await loginAs(page, "regAdmin"); for (const p of ["/college", "/college/drives", "/college/placements"]) await noSideScroll(page, p);
      await page.context().clearCookies(); await loginAs(page, "regCoord"); await noSideScroll(page, "/coordinator");
    });
  });
}

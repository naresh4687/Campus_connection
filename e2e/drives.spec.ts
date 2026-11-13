import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectOn, formAlert, loginAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const settle = async (p: Page) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(300); };
const inDays = (d: number) => { const t = new Date(Date.now() + d * 86400_000 + 5.5 * 3600_000); return t.toISOString().slice(0, 16); };   // a future IST wall-clock time

test.describe.serial("placement drives", () => {
  let officer: Page; let admin: Page;
  const open: Page[] = [];
  let driveUrl = ""; let companyUrl = "";
  const newPage = async (b: Browser) => { const p = await (await b.newContext()).newPage(); open.push(p); return p; };

  test.beforeAll(async ({ browser }) => { officer = await newPage(browser); await loginAs(officer, "officerA"); admin = await newPage(browser); await loginAs(admin, "adminA"); });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("setup: a company to run drives for", async () => {
    await officer.goto("/placement/companies/new");
    await officer.getByLabel("Company name", { exact: true }).fill("Drive Test Technologies");
    await officer.getByRole("button", { name: "Add company" }).click();
    await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}\?created=1$/);
    companyUrl = officer.url().split("?")[0];
  });

  test("a drive can be created for a company that does not exist yet: it is added automatically, and the same name in other letters reuses it", async () => {
    const draft = async (companyTyped: string) => {
      await officer.goto("/placement/drives/new");
      await officer.getByLabel("Company", { exact: true }).fill(companyTyped);
      await officer.getByLabel("Job title").fill("Associate Engineer");
      await officer.getByLabel("Employment type").selectOption("FULL_TIME");
      await officer.getByLabel("GEN").check();
      await officer.getByLabel("2026", { exact: true }).check();
      await officer.getByRole("button", { name: "Create draft" }).click();
      await officer.waitForURL(/\/placement\/drives\/[0-9a-f-]{36}\?created=1$/);
    };
    await officer.goto("/placement/companies?q=Brand%20New%20Hiring");
    await expect(officer.getByRole("link", { name: "Brand New Hiring Co" })).toHaveCount(0);
    await draft("Brand New Hiring Co");
    await expect(officer.getByText("Brand New Hiring Co").first()).toBeVisible();
    await draft("brand new hiring co");                                                   // different letters, same company
    await officer.goto("/placement/companies?q=Brand%20New%20Hiring");
    await expect(officer.getByRole("link", { name: "Brand New Hiring Co" })).toHaveCount(1);
  });

  test("a draft needs a company, title and type; invalid criteria are refused with kept values; a valid draft previews exactly what students will read", async () => {
    await officer.goto("/placement/drives/new");
    await officer.getByRole("button", { name: "Create draft" }).click(); await settle(officer);
    for (const f of ["companyName", "title", "type"]) await expect(officer.locator(`#${f}-error`)).toBeVisible();
    await officer.getByLabel("Company", { exact: true }).fill("Drive Test Technologies");
    await officer.getByLabel("Job title").fill("Graduate Engineer Trainee");
    await officer.getByLabel("Employment type").selectOption("FULL_TIME");
    await officer.getByLabel("Minimum CGPA").fill("10.5");
    await officer.getByLabel("Maximum active backlogs").fill("1.5");
    await officer.getByRole("button", { name: "Create draft" }).click(); await settle(officer);
    await expect(officer.locator("#minCgpa-error")).toBeVisible();
    await expect(officer.locator("#maxBacklogs-error")).toBeVisible();
    await expect(officer.getByLabel("Job title")).toHaveValue("Graduate Engineer Trainee");

    await officer.getByLabel("Minimum CGPA").fill("7.5");
    await officer.getByLabel("Maximum active backlogs").fill("0");
    await officer.getByLabel("Minimum 10th %").fill("60");
    await officer.getByLabel("CTC (LPA)").fill("6.5");
    await officer.getByLabel("Job description").fill("Work on <b>real</b> systems <script>window.__d=1</script>");
    await officer.getByLabel("GEN").check();
    await officer.getByLabel("2026", { exact: true }).check();
    await officer.getByRole("button", { name: "Create draft" }).click();
    await officer.waitForURL(/\/placement\/drives\/[0-9a-f-]{36}\?created=1$/);
    driveUrl = officer.url().split("?")[0];
    await expect(officer.getByText("Draft created.")).toBeVisible();
    await expect(officer.getByRole("heading", { name: "Preview — how students will see it" })).toBeVisible();
    const crit = officer.getByRole("list", { name: "Eligibility criteria" });
    await expect(crit).toContainText("Departments: GEN");
    await expect(crit).toContainText("CGPA of at least 7.50");
    await expect(crit).toContainText("10th percentage of at least 60.00%");
    await expect(crit).toContainText("At most 0 active backlogs");
    await expect(crit).toContainText("Passing year: 2026");
    await expect(crit).not.toContainText("12th");                                        // unset criteria are not shown (and are not zero)
    await expect(officer.getByRole("definition").filter({ hasText: "Work on <b>real</b> systems" })).toBeVisible();
    expect(await officer.evaluate(() => (window as unknown as { __d?: number }).__d)).toBeUndefined();
  });

  test("publishing is refused until the drive is complete, and says exactly what is missing", async () => {
    await officer.goto(driveUrl);
    await officer.getByRole("button", { name: "Publish drive" }).click();
    await expect(formAlert(officer)).toContainText("openings are missing");
    await expect(formAlert(officer)).toContainText("deadline must be in the future");
    await officer.getByLabel("Openings").fill("12");
    await officer.getByLabel("Application deadline (IST)").fill("2020-01-01T10:00");
    await officer.getByRole("button", { name: "Save draft" }).click();
    await expect(officer.getByText("Draft saved.")).toBeVisible();
    await officer.getByRole("button", { name: "Publish drive" }).click();
    await expect(formAlert(officer)).toContainText("deadline must be in the future");   // a past deadline is refused
    await officer.getByLabel("Application deadline (IST)").fill(inDays(20));
    await officer.getByRole("button", { name: "Save draft" }).click();
    await expect(officer.getByText("Draft saved.")).toBeVisible();
    await officer.getByRole("button", { name: "Publish drive" }).click();
    await expect(officer.getByText(/Drive published\. \d+ eligible students? can register now\./)).toBeVisible();
    await officer.reload();
    await expect(officer.getByRole("heading", { name: "Edit draft" })).toHaveCount(0);   // frozen
    await expect(officer.getByText("Published drives are frozen")).toBeVisible();
    await expect(officer.getByRole("heading", { name: "Drive details" })).toBeVisible();
    await expect(officer.getByLabel("Job title")).toHaveCount(0);
  });

  test("lifecycle: unpublish returns it to an editable draft; republish, close and archive; the history records each step", async () => {
    await officer.getByRole("button", { name: "Unpublish (back to draft)" }).click();
    await expect(officer.getByText("Drive unpublished.")).toBeVisible();
    await officer.reload();
    await officer.getByLabel("Job title").fill("Graduate Engineer Trainee (Revised)");
    await officer.getByRole("button", { name: "Save draft" }).click();
    await expect(officer.getByText("Draft saved.")).toBeVisible();
    await officer.getByRole("button", { name: "Publish drive" }).click();
    await expect(officer.getByText("Drive published.")).toBeVisible();
    await officer.reload();
    await officer.getByRole("button", { name: "Close drive" }).click();
    await expect(officer.getByText("Drive closed.")).toBeVisible();
    await officer.reload();
    await expect(officer.getByRole("button", { name: /Publish|Unpublish/ })).toHaveCount(0);   // a closed drive cannot be reopened
    await officer.getByRole("button", { name: "Archive drive" }).click();
    await expect(officer.getByText("Drive archived.")).toBeVisible();
    await officer.reload();
    await expect(officer.getByText("This drive is archived and read-only.")).toBeVisible();
    const hist = officer.getByRole("list", { name: "Drive history" });
    for (const e of ["Created", "Edited", "Published", "Unpublished", "Closed", "Archived"]) await expect(hist).toContainText(e);
    await expect(hist).toContainText("Test officerA");
  });

  test("the list shows status counts, search and filters; the company page lists its drives", async () => {
    await officer.goto("/placement/drives");
    await expect(officer.getByRole("row", { name: /Graduate Engineer Trainee \(Revised\)/ })).toContainText("Archived");
    await expect(officer.getByRole("link", { name: /^Archived \(1\)/ })).toBeVisible();
    await officer.goto("/placement/drives?status=PUBLISHED");
    await expect(officer.getByText("No drives found")).toBeVisible();
    await officer.goto("/placement/drives?q=drive%20test");
    await expect(officer.getByRole("row")).toHaveCount(2);
    await officer.goto("/placement/drives?q=100%25_%5C");
    await expect(officer.getByText("No drives found")).toBeVisible();
    await officer.goto(companyUrl);
    await expect(officer.getByRole("list", { name: "Company drives" })).toContainText("Graduate Engineer Trainee (Revised)");
    await officer.getByRole("link", { name: "Create a drive" }).click();
    await expect(officer.getByLabel("Company", { exact: true })).toHaveValue("Drive Test Technologies");   // company preselected
  });

  test("an inactive company cannot be used for drives, including one already drafted", async () => {
    await officer.goto("/placement/drives/new");
    await officer.getByLabel("Company", { exact: true }).fill("Drive Test Technologies");
    await officer.getByLabel("Job title").fill("Intern");
    await officer.getByLabel("Employment type").selectOption("INTERNSHIP");
    await officer.getByLabel("GEN").check(); await officer.getByLabel("2026", { exact: true }).check();
    await officer.getByLabel("Openings").fill("3"); await officer.getByLabel("Application deadline (IST)").fill(inDays(10));
    await officer.getByRole("button", { name: "Create draft" }).click();
    await officer.waitForURL(/\/placement\/drives\/[0-9a-f-]{36}\?created=1$/);
    const draftUrl = officer.url().split("?")[0];
    await officer.goto(companyUrl);
    await officer.getByRole("button", { name: "Deactivate company" }).click();
    await expect(officer.getByText("Company deactivated.")).toBeVisible();
    await officer.goto(draftUrl);
    await officer.getByRole("button", { name: "Publish drive" }).click();
    await expect(formAlert(officer)).toContainText("company is inactive");
    await officer.goto("/placement/drives/new");
    await expect(officer.locator("#companyId option", { hasText: "Drive Test Technologies" })).toHaveCount(0);
    await officer.goto(companyUrl);
    await officer.getByRole("button", { name: "Reactivate company" }).click();
    await expect(officer.getByText("Company reactivated.")).toBeVisible();
  });

  test("a college admin has read-only oversight; other roles and other colleges are locked out", async ({ browser }) => {
    await admin.goto("/college/drives");
    await expect(admin.getByRole("row", { name: /Graduate Engineer Trainee \(Revised\)/ })).toBeVisible();
    await expect(admin.getByRole("link", { name: "Create drive" })).toHaveCount(0);
    await admin.getByRole("link", { name: "Graduate Engineer Trainee (Revised)" }).click();
    await expect(admin.getByRole("heading", { name: "Drive details" })).toBeVisible();
    await expect(admin.getByRole("button", { name: /Publish|Close|Archive|Unpublish|Save/ })).toHaveCount(0);
    for (const path of ["/placement/drives", driveUrl.replace("http://127.0.0.1:3100", "")]) { await admin.goto(path); await expectOn(admin, "/college"); }
    await officer.goto("/college/drives"); await expectOn(officer, "/placement");
    for (const key of ["studentX", "coordA"]) {
      const p = await newPage(browser); await loginAs(p, key); const home = p.url();
      for (const path of ["/placement/drives", "/college/drives", driveUrl.replace("http://127.0.0.1:3100", "")]) { await p.goto(path); await expect(p).toHaveURL(home); }
    }
    const b = await newPage(browser); await loginAs(b, "officerB");
    await b.goto("/placement/drives"); await expect(b.getByText("No drives found")).toBeVisible();
    expect((await b.goto(driveUrl.replace("http://127.0.0.1:3100", "")))?.status()).toBe(404);
  });

  test("drive pages pass the automated accessibility scan and fit a phone screen", async () => {
    const targets: [Page, string[]][] = [[officer, ["/placement/drives", "/placement/drives/new", driveUrl.replace("http://127.0.0.1:3100", "")]], [admin, ["/college/drives"]]];
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

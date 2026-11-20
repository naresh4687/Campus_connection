import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { formAlert, loginAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const settle = async (p: Page) => { await p.waitForLoadState("networkidle"); await p.waitForTimeout(300); };
const inDays = (d: number) => new Date(Date.now() + d * 86400_000 + 5.5 * 3600_000).toISOString().slice(0, 16);

test.describe.serial("eligibility and registration", () => {
  let officer: Page; let regA: Page; let regB: Page; let regC: Page; let admin: Page; let otherCollege: Page;
  const open: Page[] = [];
  let driveId = "";
  const newPage = async (b: Browser, who: string) => { const p = await (await b.newContext()).newPage(); open.push(p); await loginAs(p, who); return p; };

  test.beforeAll(async ({ browser }) => {
    officer = await newPage(browser, "officerA"); regA = await newPage(browser, "regA"); regB = await newPage(browser, "regB"); regC = await newPage(browser, "regC");
    admin = await newPage(browser, "regAdmin"); otherCollege = await newPage(browser, "officerB");
  });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("setup: the officer publishes a drive requiring CGPA 7", async () => {
    await officer.goto("/placement/companies/new");
    await officer.getByLabel("Company name", { exact: true }).fill("Registration Test Corp");
    await officer.getByRole("button", { name: "Add company" }).click();
    await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}\?created=1$/);
    await officer.goto("/placement/drives/new");
    await officer.getByLabel("Company", { exact: true }).fill("Registration Test Corp");
    await officer.getByLabel("Job title").fill("Associate Engineer");
    await officer.getByLabel("Employment type").selectOption("FULL_TIME");
    await officer.getByLabel("Minimum CGPA").fill("7");
    await officer.getByLabel("Openings").fill("5");
    await officer.getByLabel("Application deadline (IST)").fill(inDays(10));
    await officer.getByLabel("REG", { exact: true }).check();
    await officer.getByLabel("2026", { exact: true }).check();
    await officer.getByRole("button", { name: "Create draft" }).click();
    await officer.waitForURL(/\/placement\/drives\/[0-9a-f-]{36}\?created=1$/);
    driveId = officer.url().split("?")[0].split("/").pop()!;
    await officer.getByRole("button", { name: "Publish drive" }).click();
    await expect(officer.getByText("Drive published.")).toBeVisible();
  });

  test("each student sees their own engine result with reasons; missing data is never zero", async () => {
    await regA.goto("/student/drives");
    const row = regA.getByRole("row", { name: /Associate Engineer/ });
    await expect(row).toContainText("Eligible");
    await regA.goto(`/student/drives/${driveId}`);
    await expect(regA.getByRole("heading", { name: "Your eligibility" })).toBeVisible();
    await expect(regA.getByRole("row", { name: /CGPA/ })).toContainText("Met");
    await expect(regA.getByRole("button", { name: "Register for this drive" })).toBeVisible();

    await regB.goto(`/student/drives/${driveId}`);
    await expect(regB.getByRole("row", { name: /CGPA/ })).toContainText("Not met");
    await expect(regB.getByRole("row", { name: /CGPA/ })).toContainText("below the minimum");
    await expect(regB.getByRole("button", { name: "Register for this drive" })).toHaveCount(0);
    await expect(regB.getByText("You are not eligible to register for this drive.")).toBeVisible();

    await regC.goto(`/student/drives/${driveId}`);
    await expect(regC.getByRole("row", { name: /Verified academic record/ })).toContainText("Missing");
    await expect(regC.getByText("Get your academic record verified to register.")).toBeVisible();
    await expect(regC.getByRole("button", { name: "Register for this drive" })).toHaveCount(0);
  });

  test("register, see it confirmed, withdraw, and register again; the page is accessible", async () => {
    await regA.goto(`/student/drives/${driveId}`);
    await regA.getByRole("button", { name: "Register for this drive" }).click();
    await expect(regA.getByText("You are registered for this drive.")).toBeVisible();
    await expect(regA.getByRole("button", { name: "Withdraw my registration" })).toBeVisible();
    const a11y = await new AxeBuilder({ page: regA }).withTags(TAGS).analyze();
    expect(a11y.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    await regA.getByRole("button", { name: "Withdraw my registration" }).click();
    await expect(regA.getByText("Your registration was withdrawn.")).toBeVisible();
    await regA.getByRole("button", { name: "Register for this drive" }).click();
    await expect(regA.getByText("You are registered for this drive.")).toBeVisible();
    await regA.goto("/student/drives");
    await expect(regA.getByRole("row", { name: /Associate Engineer/ })).toContainText("Registered");
  });

  test("the officer sees counts and the registered student's verified numbers; a résumé is only offered when one exists", async () => {
    await officer.goto(`/placement/drives/${driveId}`);
    const counts = officer.getByLabel("Drive counts");
    await expect(counts).toContainText("Registered");
    await expect(counts.locator("div", { hasText: /^Registered/ })).toContainText("1");
    await officer.getByRole("link", { name: "View registered students" }).click();
    await expect(officer.getByRole("heading", { name: "Applicants — Registration Test Corp" })).toBeVisible();
    const row = officer.getByRole("row", { name: /Test regA/ });
    await expect(row).toContainText("8.50");
    await expect(row).toContainText("None uploaded");
    await expect(officer.getByRole("row", { name: /Test regB/ })).toHaveCount(0);
    const a11y = await new AxeBuilder({ page: officer }).withTags(TAGS).analyze();
    expect(a11y.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });

  test("a drive with registrations cannot be unpublished; closing it is allowed and ends registration", async () => {
    await officer.goto(`/placement/drives/${driveId}`);
    await officer.getByRole("button", { name: "Unpublish (back to draft)" }).click();
    await expect(formAlert(officer)).toContainText("can no longer be unpublished");
    await officer.getByRole("button", { name: "Close drive" }).click();
    await expect(officer.getByText("Drive closed.")).toBeVisible();
    await regA.goto(`/student/drives/${driveId}`);
    await expect(regA.getByRole("button", { name: "Withdraw my registration" })).toHaveCount(0);
    await expect(regA.getByText("Registration is closed for this drive.")).toBeVisible();
  });

  test("admins see counts only; the other college and non-officers cannot reach applicants", async () => {
    await admin.goto(`/college/drives/${driveId}`);
    await expect(admin.getByLabel("Drive counts")).toBeVisible();
    await expect(admin.getByText("Test regA", { exact: true })).toHaveCount(0);
    for (const p of [admin, regA]) {
      const r = await p.goto(`/placement/drives/${driveId}/applicants`);
      expect(r?.status() === 404 || /\/(login|college|student)/.test(p.url()) || (await p.getByText(/not allowed|forbidden/i).count()) > 0).toBe(true);
      await expect(p.getByRole("heading", { name: /Applicants/ })).toHaveCount(0);
      await expect(p.getByRole("heading", { name: "Registered students" })).toHaveCount(0);
    }
    const r = await otherCollege.goto(`/placement/drives/${driveId}/applicants`);
    expect(r?.status()).toBe(404);
    await otherCollege.goto(`/placement/drives/${driveId}`);
    expect((await otherCollege.goto(`/placement/drives/${driveId}`))?.status()).toBe(404);
  });
});
void settle;

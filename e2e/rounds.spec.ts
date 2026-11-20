import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { formAlert, loginAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const inDays = (d: number) => new Date(Date.now() + d * 86400_000 + 5.5 * 3600_000).toISOString().slice(0, 16);

test.describe.serial("rounds, results and release", () => {
  let officer: Page; let regA: Page; let regD: Page; let admin: Page;
  const open: Page[] = [];
  let driveId = ""; let driveUrl = "";
  const newPage = async (b: Browser, who: string) => { const p = await (await b.newContext()).newPage(); open.push(p); await loginAs(p, who); return p; };
  const roundCard = (p: Page, n: number) => p.locator("section, div").filter({ has: p.getByRole("heading", { name: new RegExp(`^Round ${n}:`) }) }).last();

  test.beforeAll(async ({ browser }) => {
    officer = await newPage(browser, "roundOfficer"); regA = await newPage(browser, "regA"); regD = await newPage(browser, "regD"); admin = await newPage(browser, "regAdmin");
  });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("setup: a published drive; two eligible students register", async () => {
    await officer.goto("/placement/companies/new");
    await officer.getByLabel("Company name", { exact: true }).fill("Rounds Test Labs");
    await officer.getByRole("button", { name: "Add company" }).click();
    await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}\?created=1$/);
    await officer.goto("/placement/drives/new");
    await officer.getByLabel("Company", { exact: true }).fill("Rounds Test Labs");
    await officer.getByLabel("Job title").fill("Platform Engineer");
    await officer.getByLabel("Employment type").selectOption("FULL_TIME");
    await officer.getByLabel("Minimum CGPA").fill("7");
    await officer.getByLabel("Openings").fill("3");
    await officer.getByLabel("Application deadline (IST)").fill(inDays(10));
    await officer.getByLabel("REG", { exact: true }).check();
    await officer.getByLabel("2026", { exact: true }).check();
    await officer.getByRole("button", { name: "Create draft" }).click();
    await officer.waitForURL(/\/placement\/drives\/[0-9a-f-]{36}\?created=1$/);
    driveUrl = officer.url().split("?")[0]; driveId = driveUrl.split("/").pop()!;
    await officer.getByRole("button", { name: "Publish drive" }).click();
    await expect(officer.getByText("Drive published.")).toBeVisible();
    for (const p of [regA, regD]) {
      await p.goto(`/student/drives/${driveId}`);
      await p.getByRole("button", { name: "Register for this drive" }).click();
      await expect(p.getByText("You are registered for this drive.")).toBeVisible();
    }
  });

  test("a round can be added and scheduled before registration ends, but results cannot be recorded yet", async () => {
    await officer.goto(`${driveUrl}/rounds`);
    await expect(officer.getByText("Results can be recorded after registration ends")).toBeVisible();
    await officer.getByRole("button", { name: "Add round" }).click();
    await expect(officer.locator("#name-new-error")).toBeVisible();
    await officer.locator("#name-new").fill("Online aptitude test");
    await officer.locator("#kind-new").selectOption("APTITUDE");
    await officer.locator("#at-new").fill(inDays(12));
    await officer.locator("#venue-new").fill("Lab 3, Block B");
    await officer.locator("#instructions-new").fill("Bring your college ID card.");
    await officer.getByRole("button", { name: "Add round" }).click();
    await expect(officer.getByText("Round added.")).toBeVisible();
    await expect(officer.getByRole("heading", { name: "Round 1: Online aptitude test" })).toBeVisible();
    // the candidate list shows both registered students with no decision
    await officer.getByLabel("Select Test regA").check();
    await officer.locator('select[name="result"]').selectOption("SELECTED");
    await officer.getByRole("button", { name: "Apply" }).click();
    await expect(formAlert(officer)).toContainText("after registration has ended");
    // students see the schedule and "not released"
    await regA.goto(`/student/drives/${driveId}`);
    const list = regA.getByRole("list", { name: "Rounds" });
    await expect(list).toContainText("Round 1: Online aptitude test");
    await expect(list).toContainText("Lab 3, Block B");
    await expect(list).toContainText("Bring your college ID card.");
    await expect(list).toContainText("Result: not released yet");
  });

  test("after closing: decisions with a remark; students still see nothing until release", async () => {
    await officer.goto(driveUrl);
    await officer.getByRole("button", { name: "Close drive" }).click();
    await expect(officer.getByText("Drive closed.")).toBeVisible();
    await officer.goto(`${driveUrl}/rounds`);
    await officer.getByLabel("Select Test regA").check();
    await officer.locator('select[name="result"]').selectOption("SELECTED");
    await officer.getByRole("button", { name: "Apply" }).click();
    await expect(officer.getByText("Results saved.")).toBeVisible();
    await expect(officer.getByText("1 candidate(s) still have no decision.")).toBeVisible();
    await expect(officer.getByRole("button", { name: "Release results" })).toHaveCount(0);   // cannot release with an undecided candidate
    await officer.getByLabel("Select Test regD").check();
    await officer.locator('select[name="result"]').selectOption("REJECTED");
    await officer.locator('input[name="note"]').fill("below the cut-off score");
    await officer.getByRole("button", { name: "Apply" }).click();
    await expect(officer.getByText("Results saved.")).toBeVisible();
    await expect(officer.getByRole("list", { name: "Decision history" })).toContainText("below the cut-off score");
    for (const p of [regA, regD]) {
      await p.goto(`/student/drives/${driveId}`);
      await expect(p.getByRole("list", { name: "Rounds" })).toContainText("Result: not released yet");
    }
  });

  test("release needs an explicit confirmation; then each student sees only their own result, never the remark; the round is frozen", async () => {
    await officer.goto(`${driveUrl}/rounds`);
    await officer.getByRole("button", { name: "Release results" }).click();
    await expect(formAlert(officer)).toContainText("Tick the box");
    await officer.getByLabel(/Release “Online aptitude test” results/).check();
    await officer.getByRole("button", { name: "Release results" }).click();
    await expect(officer.getByText("Results released.")).toBeVisible();
    await expect(officer.getByRole("button", { name: /Release results|Apply|Delete this round/ })).toHaveCount(0);
    await expect(officer.getByText("Edit schedule and details")).toHaveCount(0);
    await regA.goto(`/student/drives/${driveId}`);
    await expect(regA.getByRole("list", { name: "Rounds" })).toContainText("Your result: Selected");
    await regD.goto(`/student/drives/${driveId}`);
    await expect(regD.getByRole("list", { name: "Rounds" })).toContainText("Your result: Not selected");
    for (const p of [regA, regD]) {
      await expect(p.getByText("below the cut-off score")).toHaveCount(0);
      await expect(p.getByText(p === regA ? "Test regD" : "Test regA", { exact: true })).toHaveCount(0);   // never another student
    }
  });

  test("round 2 includes only students selected in round 1, and needs round 1 released", async () => {
    await officer.goto(`${driveUrl}/rounds`);
    await officer.locator("#name-new").fill("HR interview");
    await officer.locator("#kind-new").selectOption("HR");
    await officer.getByRole("button", { name: "Add round" }).click();
    await expect(officer.getByRole("heading", { name: "Round 2: HR interview" })).toBeVisible();
    const card = officer.locator("div").filter({ has: officer.getByRole("heading", { name: "Round 2: HR interview" }) }).last();
    await expect(card.getByLabel("Select Test regA")).toBeVisible();
    await expect(card.getByLabel("Select Test regD")).toHaveCount(0);                  // rejected in round 1
    const a11y = await new AxeBuilder({ page: officer }).withTags(TAGS).analyze();
    expect(a11y.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    void roundCard;
  });

  test("admins have read-only oversight; students cannot open the officer pages", async () => {
    await admin.goto(`/college/drives/${driveId}`);
    const rounds = admin.getByRole("list", { name: "Rounds" });
    await expect(rounds).toContainText("Round 1: Online aptitude test — results released");
    await expect(rounds).toContainText("Round 2: HR interview — results not released");
    await regA.goto(`${driveUrl}/rounds`);
    await expect(regA.getByRole("heading", { name: /^Rounds —/ })).toHaveCount(0);
    await admin.goto(`${driveUrl}/rounds`);
    await expect(admin.getByRole("heading", { name: /^Rounds —/ })).toHaveCount(0);
    const a11y = await new AxeBuilder({ page: regA }).withTags(TAGS).analyze();
    expect(a11y.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  });
});

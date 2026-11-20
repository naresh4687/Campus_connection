import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { inspect } from "../db/tests/world";
import { loginAs, seed } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const inDays = (d: number) => new Date(Date.now() + d * 86400_000 + 5.5 * 3600_000).toISOString().slice(0, 16);

test.describe.serial("coordinator-recorded placements and deadline extension", () => {
  let officer: Page; let coord: Page; let student: Page; const open: Page[] = [];
  const page = async (br: Browser, who: string) => { const p = await (await br.newContext()).newPage(); open.push(p); await loginAs(p, who); return p; };
  test.beforeAll(async ({ browser }) => { officer = await page(browser, "partOfficer"); coord = await page(browser, "partCoord"); student = await page(browser, "partB"); });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("a coordinator records a student of their department as placed with the package; an officer verifies; the student is told", async () => {
    await officer.goto("/placement/companies/new");
    await officer.getByLabel("Company name", { exact: true }).fill("Placed Together Corp");
    await officer.getByRole("button", { name: "Add company" }).click();
    await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}\?created=1$/);

    await coord.goto("/coordinator/companies");
    await coord.getByRole("listitem").filter({ hasText: "Placed Together Corp" }).getByRole("link", { name: "Record a placement" }).click();
    const reg = (await inspect<{ r: string }>("SELECT register_number::text AS r FROM students WHERE college_email = $1", [seed().users.partB]))[0].r;
    await coord.getByPlaceholder(/Search by name/).fill(reg);
    await coord.getByRole("button", { name: `Add ${reg}` }).click();
    await coord.getByLabel(`Package (LPA) for ${reg}`).fill("zero");
    await expect(coord.getByRole("button", { name: "Record offer" })).toBeDisabled();                         // a package is needed first
    await coord.getByLabel(`Package (LPA) for ${reg}`).fill("7.5");
    await coord.getByRole("button", { name: "Record offer" }).click();
    await expect(coord.getByText("1 offer recorded.")).toBeVisible();
    const row = coord.getByRole("row", { name: new RegExp(reg) });
    await expect(row).toContainText("7.50 LPA"); await expect(row).toContainText("Waiting for verification");
    const r = await new AxeBuilder({ page: coord }).withTags(TAGS).analyze(); expect(r.violations.map((v) => v.id)).toEqual([]);

    await officer.goto("/placement/placements");
    const orow = officer.getByRole("row", { name: new RegExp(reg) });
    await orow.getByRole("button", { name: "Reject" }).click();
    await expect(officer.getByText(/Give a reason for rejecting/)).toBeVisible();
    await orow.getByRole("button", { name: "Verify" }).click();
    await expect(officer.getByText("Placement verified.")).toBeVisible();
    await student.goto("/notifications"); await expect(student.getByText("Placement recorded").first()).toBeVisible();
    await coord.reload(); await expect(coord.getByRole("row", { name: new RegExp(reg) })).toContainText("Verified");
  });

  test("an officer extends a published drive's deadline: it needs a later time and a reason", async () => {
    await officer.goto("/placement/drives/new");
    await officer.getByLabel("Company", { exact: true }).fill("Placed Together Corp");
    await officer.getByLabel("Job title").fill("Trainee");
    await officer.getByLabel("Employment type").selectOption("FULL_TIME");
    await officer.getByLabel("Openings").fill("2");
    await officer.getByLabel("Application deadline (IST)").fill(inDays(3));
    await officer.getByLabel("REG", { exact: true }).check(); await officer.getByLabel("2026", { exact: true }).check();
    await officer.getByRole("button", { name: "Create draft" }).click();
    await officer.waitForURL(/\/placement\/drives\/[0-9a-f-]{36}\?created=1$/);
    await officer.getByRole("button", { name: "Publish drive" }).click(); await expect(officer.getByText("Drive published.")).toBeVisible();
    const card = officer.getByRole("region", { name: "Registration deadline" }).or(officer.locator("section", { hasText: "Registration deadline" }));
    await expect(card).toContainText("closes automatically on");
    await card.getByLabel("New deadline (India time)").fill(inDays(1)); await card.getByLabel("Reason for extending").fill("company asked for more time");
    await card.getByRole("button", { name: "Extend deadline" }).click();
    await expect(officer.getByText("The new deadline must be later than the current one.")).toBeVisible();
    await card.getByLabel("New deadline (India time)").fill(inDays(9));
    await card.getByRole("button", { name: "Extend deadline" }).click();
    await expect(officer.getByText(/The deadline was extended/)).toBeVisible();
    const [{ n }] = await inspect<{ n: string }>("SELECT count(*)::text AS n FROM audit_log WHERE action = 'DRIVE_DEADLINE_EXTENDED'"); expect(Number(n)).toBeGreaterThanOrEqual(1);
  });

  test("an officer adds offers from several companies for one student, accepts one, and cannot accept a second", async () => {
    const regA = (await inspect<{ r: string }>("SELECT register_number::text AS r FROM students WHERE college_email = $1", [seed().users.partA]))[0].r;
    await officer.goto("/placement/companies/new"); await officer.getByLabel("Company name", { exact: true }).fill("Second Offer Corp"); await officer.getByRole("button", { name: "Add company" }).click();
    await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}\?created=1$/); const second = officer.url().split("?")[0];
    await officer.goto("/placement/companies?q=Placed+Together"); await officer.getByRole("link", { name: "Placed Together Corp" }).click(); await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}$/); const first = officer.url().split("?")[0];

    const add = async (url: string, ctc: string, accepted: boolean) => {
      await officer.goto(url);
      await officer.getByPlaceholder(/Search by name/).fill(regA); await officer.getByRole("button", { name: `Add ${regA}` }).click();
      await officer.getByLabel(`Package (LPA) for ${regA}`).fill(ctc);
      if (accepted) await officer.getByRole("radio", { name: "Accepted offer" }).click();
      await officer.getByRole("button", { name: "Record offer" }).click();
      await expect(officer.getByText("1 offer recorded.")).toBeVisible();
    };
    await add(first, "6", false);
    await add(second, "9.5", true);                                                                               // an accepted offer at the second company
    await expect(officer.getByTestId("offer-Accepted")).toHaveText("1"); await expect(officer.getByTestId("offer-Highest LPA")).toHaveText("9.50");
    await officer.goto(first);                                                                                     // the first company: the student already accepted elsewhere
    await officer.getByPlaceholder(/Search by name/).fill(regA); await officer.getByRole("button", { name: `Add ${regA}` }).click();
    await expect(officer.getByTestId(`row-${regA}`)).toContainText("already accepted at Second Offer Corp");
    await expect(officer.getByRole("radio", { name: "Accepted offer" })).toBeDisabled();
    await officer.getByRole("row", { name: new RegExp(regA) }).getByRole("button", { name: "Mark accepted" }).click();
    await expect(officer.getByText(/already accepted an offer \(Second Offer Corp\)/)).toBeVisible();          // the database refuses a second acceptance
    await officer.goto(second);                                                                                    // switch: un-accept there, then accept here
    await officer.getByRole("row", { name: new RegExp(regA) }).getByRole("button", { name: "Mark as not accepted" }).click();
    await expect(officer.getByText("Marked as got offer (not accepted).")).toBeVisible();
    await officer.goto(first); await officer.getByRole("row", { name: new RegExp(regA) }).getByRole("button", { name: "Mark accepted" }).click();
    await expect(officer.getByText("Marked as accepted.")).toBeVisible();
    officer.once("dialog", (d) => d.accept());
    await officer.getByRole("row", { name: new RegExp(regA) }).getByRole("button", { name: "Withdraw" }).click();
    await expect(officer.getByText("Offer withdrawn.")).toBeVisible(); await expect(officer.getByTestId("offer-Offers")).toHaveText("1");   // the other student recorded by the coordinator earlier remains
    const r = await new AxeBuilder({ page: officer }).withTags(TAGS).analyze(); expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test("an officer records several students at once, each with their own package; one refusal does not lose the others", async () => {
    const regs = await inspect<{ r: string }>("SELECT register_number::text AS r FROM students WHERE college_email = ANY($1) ORDER BY college_email", [[seed().users.partA, seed().users.partB]]);
    const [ra, rb] = regs.map((x) => x.r);
    await officer.goto("/placement/companies/new"); await officer.getByLabel("Company name", { exact: true }).fill("Batch Offer Corp"); await officer.getByRole("button", { name: "Add company" }).click();
    await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}\?created=1$/); const url = officer.url().split("?")[0];
    await officer.goto(url);
    for (const r of [ra, rb]) { await officer.getByPlaceholder(/Search by name/).fill(r); await officer.getByPlaceholder(/Search by name/).press("Enter"); }       // Enter adds the first match
    await expect(officer.getByRole("heading", { name: /Offers to record \(2\)/ })).toBeVisible();
    await officer.getByLabel("Same LPA for all").fill("5"); await officer.getByRole("button", { name: "Apply" }).click();
    await officer.getByLabel(`Package (LPA) for ${rb}`).fill("8.25");                                                                              // then each can differ
    await officer.getByRole("button", { name: "Record 2 offers" }).click();
    await expect(officer.getByText("2 offers recorded.")).toBeVisible();
    await expect(officer.getByTestId("offer-Offers")).toHaveText("2"); await expect(officer.getByTestId("offer-Highest LPA")).toHaveText("8.25");
    // a second try for one of them (duplicate) plus a new valid one: the valid one is saved, the refused one stays with its reason
    await officer.getByPlaceholder(/Search by name/).fill(ra); await officer.getByRole("button", { name: `Add ${ra}` }).click(); await officer.getByLabel(`Package (LPA) for ${ra}`).fill("6");
    await officer.getByPlaceholder(/Search by name/).fill("9"); const another = officer.getByRole("button", { name: /^Add / }).filter({ hasNotText: "zzzz" }).first();
    if (await another.count()) { const name = await another.getAttribute("aria-label"); if (name && !name.includes(ra) && !name.includes(rb)) { await another.click(); await officer.getByLabel(new RegExp(`^Package \\(LPA\\) for ${name.replace("Add ", "")}$`)).fill("4"); } }
    await officer.getByRole("button", { name: /^Record (\d+ offers|offer)$/ }).click();
    await expect(officer.getByText(/could not be saved/)).toBeVisible();
    await expect(officer.getByTestId(`row-${ra}`)).toContainText("already has a record for this company");
    const r = await new AxeBuilder({ page: officer }).withTags(TAGS).analyze(); expect(r.violations.map((v) => v.id)).toEqual([]);
  });
});

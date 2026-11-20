import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { loginAs } from "./helpers";

// Career preference: coordinators move students (bulk and one by one) with a reason; students see theirs read-only.
// regCoord looks after the REG department; regC is one of its students and has an account.
test.describe.serial("career preference", () => {
  test("a coordinator moves a student with a reason; filter, detail page and history show it", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await loginAs(page, "regCoord");
    await page.goto("/coordinator/students?q=regC");
    await expect(page.getByRole("row", { name: /Test regC/ })).toContainText("Undecided");
    await page.getByRole("checkbox", { name: "Select Test regC" }).check();
    await page.getByLabel("Move to").selectOption({ label: "Higher studies interested" });
    await page.getByLabel("Reason").fill("Plans an MS abroad");
    await page.getByRole("button", { name: "Update selected" }).click();
    await expect(page.getByText("Updated 1 student.")).toBeVisible();

    await page.goto("/coordinator/students?career=HIGHER_STUDIES");
    await expect(page.getByRole("row", { name: /Test regC/ })).toContainText("Higher studies interested");
    await page.getByRole("link", { name: "Test regC" }).click();
    const history = page.getByRole("list", { name: "Career preference history" });
    await expect(history).toContainText("Undecided");
    await expect(history).toContainText("Higher studies interested");
    await expect(history).toContainText("Plans an MS abroad");
    expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.map((v) => v.id)).toEqual([]);

    // the student may change their mind later: the coordinator moves them back, and both steps are kept
    await page.getByLabel("Move to").selectOption({ label: "Placement interested" });
    await page.getByLabel("Reason").fill("Changed their mind after the briefing");
    await page.getByRole("button", { name: "Update preference" }).click();
    await expect(page.getByText("Updated 1 student.")).toBeVisible();
    await expect(history.getByRole("listitem")).toHaveCount(2);
    await page.context().close();
  });

  test("an empty reason or no selection is refused with a clear message", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await loginAs(page, "regCoord");
    await page.goto("/coordinator/students?q=regC");
    await page.getByLabel("Reason").fill("   ");
    await page.getByRole("button", { name: "Update selected" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /Select at least one student|short reason/ })).toBeVisible();
    await page.context().close();
  });

  test("the student sees their own preference and history, read-only, with no way to change it", async ({ browser }) => {
    const page = await (await browser.newContext()).newPage();
    await loginAs(page, "regC");
    await page.goto("/student/profile");
    await expect(page.getByRole("heading", { name: "Career interest" })).toBeVisible();
    await expect(page.getByText("Placement interested").first()).toBeVisible();
    await expect(page.getByRole("list", { name: "Career preference history" })).toContainText("Plans an MS abroad");
    await expect(page.getByRole("button", { name: /Update (preference|selected)/ })).toHaveCount(0);
    await page.context().close();
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const violationsOf = async (page: Page) => (await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id);

/** Automated WCAG 2.1 A/AA checks (axe-core). Catches many, not all, accessibility problems — it is not a substitute for a manual audit. */
async function scan(page: Page, path: string) {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  const bad = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(bad, `${path}\n${bad.join("\n")}`).toEqual([]);
}

const PUBLIC_PAGES = ["/", "/features", "/how-it-works", "/apply", "/contact", "/privacy", "/terms", "/login", "/forgot-password", "/no-such-page"];

// The dark theme has its own palette, so its contrast is checked separately (the device setting decides the theme when no choice is saved).
test.describe("accessibility in the dark theme (axe, WCAG 2.1 A/AA)", () => {
  test.use({ colorScheme: "dark" });
  for (const path of PUBLIC_PAGES) {
    test(`public ${path} (dark)`, async ({ page }) => { await scan(page, path); });
  }
});

test.describe("accessibility (axe, WCAG 2.1 A/AA)", () => {
  for (const path of PUBLIC_PAGES) {
    test(`public ${path}`, async ({ page }) => { await scan(page, path); });
  }
  test("application form with validation errors showing", async ({ page }) => {
    await page.goto("/apply");
    await page.getByRole("button", { name: "Submit application" }).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("#name-error")).toBeVisible();
    expect(await violationsOf(page)).toEqual([]);
  });
  test("negative control: the scanner does flag a deliberately inaccessible page", async ({ page }) => {
    await page.setContent('<html lang="en"><body><img src="x.png"><button></button><input type="text"></body></html>');
    const ids = await violationsOf(page);
    expect(ids).toEqual(expect.arrayContaining(["image-alt", "button-name", "label"]));
  });
  test("platform console pages", async ({ page }) => {
    await loginAs(page, "platform");
    for (const path of ["/platform", "/platform/applications", "/platform/colleges", "/platform/inquiries", "/platform/audit", "/account"]) await scan(page, path);
  });
});

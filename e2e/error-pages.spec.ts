import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

// Next's built-in error page uses inline styles that our CSP blocks. These pin our own pages, using test-only crash
// pages (src/server/e2e-fault.ts) that exist only on the Playwright server.
const cspViolations = (page: Page) => {
  const found: string[] = [];
  page.on("console", (m) => { if (/Content Security Policy/i.test(m.text())) found.push(m.text()); });
  return found;
};

test.describe("something went wrong", () => {
  test("a crash outside the portal shows the branded error page without leaking the error", async ({ page }) => {
    const csp = cspViolations(page);
    await page.goto("/e2e-fault");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
    await expect(page.getByText(/^Reference:/)).toBeVisible(); // the digest, to match the server log
    expect(await page.content()).not.toContain("Deliberate test fault"); // the real message stays on the server
    expect(csp, csp.join("\n")).toEqual([]);
    const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(axe.violations.map((v) => v.id)).toEqual([]);
  });

  test("a crash inside the portal keeps the signed-in shell", async ({ page }) => {
    await loginAs(page, "rptOfficer");
    const csp = cspViolations(page);
    await page.goto("/account/e2e-fault");
    await page.waitForLoadState("networkidle");
    await expect(page.getByRole("heading", { level: 1, name: "Something went wrong" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to your dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Apply as a college" })).toHaveCount(0);
    await expect(page.locator("main")).toHaveCount(1);
    expect(await page.content()).not.toContain("Deliberate test fault");
    expect(csp, csp.join("\n")).toEqual([]);
  });
});

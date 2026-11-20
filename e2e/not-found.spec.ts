import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

// Next's built-in 404 uses inline styles that our CSP blocks, so it rendered as bare unstyled text. These pin our own pages.
const collectConsoleErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("console", (m) => { if (m.type() === "error" && !/status of 404/.test(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  return errors;
};

test.describe("page not found", () => {
  for (const width of [320, 1440]) {
    test(`an unknown public URL shows the branded 404 at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      const errors = collectConsoleErrors(page);
      const r = await page.goto("/no-such-page");
      await page.waitForLoadState("networkidle");
      expect(r?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Features" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Go to the home page" })).toHaveAttribute("href", "/");
      await expect(page.getByText("This page could not be found.")).toHaveCount(0); // Next's default page is gone
      expect(errors, errors.join("\n")).toEqual([]); // includes CSP violations
      const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(o.scroll).toBeLessThanOrEqual(o.inner);
    });
  }

  test("a missing record inside the portal keeps the signed-in shell", async ({ page }) => {
    await loginAs(page, "rptOfficer");
    const errors = collectConsoleErrors(page);
    const r = await page.goto(`/placement/drives/${randomUUID()}`);
    await page.waitForLoadState("networkidle");
    expect(r?.status()).toBe(404);
    await expect(page.getByRole("heading", { level: 1, name: "Page not found" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Back to your dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Apply as a college" })).toHaveCount(0); // not the public header
    await expect(page.locator("main")).toHaveCount(1);
    expect(errors, errors.join("\n")).toEqual([]);
  });
});

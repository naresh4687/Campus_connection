import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

const noHorizontalScroll = async (page: Page, path: string, width: number) => {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(o.scroll, `${path} @${width}px scrollWidth ${o.scroll} > ${o.inner}`).toBeLessThanOrEqual(o.inner);
};

for (const width of [320, 360, 414, 768, 1024, 1440, 1920, 2560]) {
  test.describe(`layout at ${width}px wide`, () => {
    test.use({ viewport: { width, height: 800 } });
    for (const path of ["/", "/features", "/how-it-works", "/apply", "/contact", "/privacy", "/terms", "/login"]) {
      test(`public ${path} does not scroll sideways`, async ({ page }) => { await noHorizontalScroll(page, path, width); });
    }
  });
}

// Every role's main pages across phone, tablet, laptop and wide screens. One sign-in per role (sign-ins are throttled), then the window is resized.
const WIDTHS = [320, 360, 414, 768, 820, 1024, 1280, 1440, 1920, 2560];
const ROLES: { name: string; key: string; paths: string[] }[] = [
  { name: "platform administrator", key: "platform", paths: ["/platform", "/platform/applications", "/platform/colleges", "/platform/inquiries", "/platform/audit"] },
  { name: "college administrator", key: "regAdmin", paths: ["/college", "/college/departments", "/college/staff", "/college/students", "/college/drives", "/college/placements", "/college/reports", "/college/settings", "/college/audit"] },
  { name: "placement officer", key: "offerOfficer", paths: ["/placement", "/placement/drives", "/placement/drives/new", "/placement/companies", "/placement/placements", "/placement/reports"] },
  { name: "coordinator", key: "regCoord", paths: ["/coordinator", "/coordinator/students", "/coordinator/verification", "/coordinator/requests"] },
  { name: "student", key: "offB", paths: ["/student", "/student/drives", "/student/offers", "/student/profile", "/student/documents", "/student/academics"] },
];

test.describe("portals fit every screen size", () => {
  test.setTimeout(240_000);
  for (const role of ROLES) {
    test(`${role.name}: no sideways scroll from 320px to 2560px, sidebar from tablet width`, async ({ page }) => {
      await loginAs(page, role.key);
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: width >= 1024 ? 900 : 800 });
        for (const path of role.paths) {
          await noHorizontalScroll(page, path, width);
          // Navigation: a sidebar (sticky, left) from 768px up; a stacked header above the content below that.
          const box = await page.locator("header").first().boundingBox();
          if (width >= 768) expect(box?.width ?? 0, `${path} @${width}px sidebar is a side column (it scales with the root font size)`).toBeLessThan(width * 0.4);
          else expect(box?.width ?? 0, `${path} @${width}px stacked header spans the screen`).toBeGreaterThan(width - 4);
        }
      }
    });
  }

  test("tables become labelled stacked rows on a phone and normal tables on a wide screen", async ({ page }) => {
    await loginAs(page, "regAdmin");
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto("/college/staff");
    await page.waitForLoadState("networkidle");
    const cell = page.locator(".rtable tbody td[data-label]").first();
    await expect(cell).toBeVisible();
    expect(await cell.evaluate((el) => getComputedStyle(el).display)).toBe("flex");
    await page.setViewportSize({ width: 1440, height: 900 });
    expect(await cell.evaluate((el) => getComputedStyle(el).display)).toBe("table-cell");
  });
});

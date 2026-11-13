import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

const noHorizontalScroll = async (page: Page, path: string, width: number) => {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  expect(o.scroll, `${path} @${width}px scrollWidth ${o.scroll} > ${o.inner}`).toBeLessThanOrEqual(o.inner);
};

for (const width of [360, 768]) {
  test.describe(`layout at ${width}px wide`, () => {
    test.use({ viewport: { width, height: 800 } });
    for (const path of ["/", "/features", "/how-it-works", "/apply", "/contact", "/privacy", "/terms", "/login"]) {
      test(`public ${path} does not scroll sideways`, async ({ page }) => { await noHorizontalScroll(page, path, width); });
    }
    test("platform console does not scroll sideways (tables scroll inside their own container)", async ({ page }) => {
      await loginAs(page, "platform");
      for (const path of ["/platform", "/platform/applications", "/platform/colleges", "/platform/inquiries", "/platform/audit"]) await noHorizontalScroll(page, path, width);
    });
  });
}

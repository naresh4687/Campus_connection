// Renders the CampusConnect mark (see src/components/ui/logo.tsx) to the PNG icons the installable app needs.
// Run: node scripts/generate-icons.mjs   (uses the Playwright Chromium already installed for the browser tests)
import { chromium } from "@playwright/test";
import { writeFileSync } from "node:fs";

const BRAND = "#a3e14e", INK = "#101210";
// Same C as the logo (28-unit box). `pad` shrinks the mark so a maskable icon keeps it inside the 80% safe zone.
const svg = (size, { maskable }) => {
  const scale = maskable ? 0.62 : 0.8, tx = (28 - 28 * scale) / 2;
  const tile = maskable ? `<rect width="28" height="28" fill="${BRAND}"/>` : `<rect width="28" height="28" rx="8" fill="${BRAND}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28">${tile}<g transform="translate(${tx} ${tx}) scale(${scale})"><path d="M19.4 9.6a7 7 0 1 0 0 8.8" fill="none" stroke="${INK}" stroke-width="3.4" stroke-linecap="round"/></g></svg>`;
};
const jobs = [
  ["public/icons/icon-192.png", 192, false], ["public/icons/icon-512.png", 512, false],
  ["public/icons/maskable-512.png", 512, true], ["public/icons/apple-touch-icon.png", 180, true],
];
const browser = await chromium.launch();
for (const [file, size, maskable] of jobs) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg(size, { maskable })}</body></html>`);
  writeFileSync(file, await page.screenshot({ omitBackground: true, type: "png" }));
  await page.close();
}
writeFileSync("public/icons/icon.svg", svg(512, { maskable: false }));
await browser.close();
console.log("icons written");

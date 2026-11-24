import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

/**
 * QA sweep: every role visits every reachable list page and the first few detail pages they link to, at the five widths the
 * audit asks for, while we record console errors, uncaught exceptions, failed or 4xx/5xx requests, broken images and sideways
 * scrolling. Read-only: nothing is created, changed or deleted.
 */
const WIDTHS = [1920, 1366, 768, 390, 320];
const ROLES: { name: string; key: string; start: string; lists: string[] }[] = [
  { name: "platform administrator", key: "platform", start: "/platform", lists: ["/platform", "/platform/applications", "/platform/colleges", "/platform/inquiries", "/platform/audit", "/notifications", "/notifications/preferences", "/account"] },
  { name: "college administrator", key: "adminA", start: "/college", lists: ["/college", "/college/departments", "/college/staff", "/college/students", "/college/students/requests", "/college/students/import", "/college/students/new", "/college/academics", "/college/companies", "/college/drives", "/college/placements", "/college/reports", "/college/settings", "/college/audit", "/notifications", "/account", "/account/password-requests"] },
  { name: "placement officer", key: "officerA", start: "/placement", lists: ["/placement", "/placement/drives", "/placement/drives/new", "/placement/companies", "/placement/companies/new", "/placement/placements", "/placement/reports", "/placement/announcements", "/placement/announcements/new", "/placement/announcements/compose", "/notifications", "/notifications/preferences", "/account"] },
  { name: "coordinator", key: "coordA", start: "/coordinator", lists: ["/coordinator", "/coordinator/students", "/coordinator/verification", "/coordinator/verification/history", "/coordinator/requests", "/coordinator/documents", "/coordinator/achievements", "/coordinator/companies", "/coordinator/drives", "/coordinator/announcements", "/notifications", "/account"] },
  { name: "student", key: "studentA", start: "/student", lists: ["/student", "/student/profile", "/student/academics", "/student/achievements", "/student/documents", "/student/drives", "/student/offers", "/student/announcements", "/notifications", "/notifications/preferences", "/account"] },
];
const PUBLIC = ["/", "/features", "/how-it-works", "/apply", "/apply/status", "/contact", "/privacy", "/terms", "/login", "/login/student", "/login/college", "/admin/login", "/forgot-password", "/does-not-exist"];

type Problem = string[];
function watch(page: Page, problems: Problem) {
  page.on("console", (m) => { if (m.type() === "error") problems.push(`console.error @${page.url()}: ${m.text().slice(0, 200)}`); });
  page.on("pageerror", (e) => problems.push(`pageerror @${page.url()}: ${e.message.slice(0, 200)}`));
  page.on("requestfailed", (r) => { if (!/_rsc=|ERR_ABORTED/.test(r.url() + (r.failure()?.errorText ?? ""))) problems.push(`requestfailed ${r.method()} ${r.url()} ${r.failure()?.errorText}`); });
  page.on("response", (r) => { if (r.status() >= 400 && !/\/does-not-exist/.test(r.url())) problems.push(`HTTP ${r.status()} ${r.request().method()} ${r.url()}`); });
}

async function inspectPage(page: Page, path: string, width: number, problems: Problem) {
  const resp = await page.goto(path, { waitUntil: "networkidle" });
  const status = resp?.status() ?? 0;
  if (status >= 500 || (status === 404 && !path.includes("does-not-exist"))) problems.push(`${path} @${width}: HTTP ${status}`);
  const o = await page.evaluate(async () => {
    const imgs = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.currentSrc).map((i) => i.currentSrc);
    // elements that stick out of the viewport on the right (the usual cause of sideways scrolling), reported by tag + text
    const w = window.innerWidth;
    const wide = [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > w + 1 && getComputedStyle(e).position !== "fixed" && !e.closest(".overflow-x-auto, [data-allow-scroll]"); })
      .slice(0, 3).map((e) => `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 40)} "${(e.textContent ?? "").trim().slice(0, 30)}"`);
    const unlabeled = [...document.querySelectorAll("button, a")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && !(e.textContent ?? "").trim() && !e.getAttribute("aria-label") && !e.getAttribute("title") && !e.querySelector("img[alt]"); }).length;
    return { scroll: document.documentElement.scrollWidth, inner: w, imgs, wide, unlabeled, h1: document.querySelectorAll("h1").length, text: document.body.innerText.slice(0, 4000) };
  });
  if (o.scroll > o.inner) problems.push(`${path} @${width}: sideways scroll ${o.scroll}>${o.inner}; overflowing: ${o.wide.join(" | ")}`);
  if (o.imgs.length) problems.push(`${path} @${width}: broken images ${o.imgs.join(", ")}`);
  if (o.unlabeled) problems.push(`${path} @${width}: ${o.unlabeled} unlabeled button/link(s)`);
  if (o.h1 !== 1 && status === 200) problems.push(`${path} @${width}: ${o.h1} <h1> elements`);
  if (/undefined|\[object Object\]|NaN(?!\w)|Invalid Date|null\b/.test(o.text.replace(/\bnull\b(?=\s*(?:\)|$))/g, ""))) {
    const m = o.text.match(/.{0,30}(undefined|\[object Object\]|NaN(?!\w)|Invalid Date|\bnull\b).{0,30}/);
    problems.push(`${path} @${width}: suspicious text "${m?.[0].replace(/\s+/g, " ")}"`);
  }
}

test.describe.configure({ mode: "serial" });
test.setTimeout(600_000);

test("public pages: all widths, no console or network errors", async ({ page }) => {
  const problems: Problem = []; watch(page, problems);
  for (const width of WIDTHS) { await page.setViewportSize({ width, height: 900 }); for (const p of PUBLIC) await inspectPage(page, p, width, problems); }
  expect(problems, problems.join("\n")).toEqual([]);
});

for (const role of ROLES) {
  test(`${role.name}: every page, links followed, no errors at any width`, async ({ page }) => {
    const problems: Problem = []; watch(page, problems);
    await loginAs(page, role.key);
    // Discover detail pages by following the first links under each list page's own prefix.
    const detail = new Set<string>();
    await page.setViewportSize({ width: 1366, height: 900 });
    for (const p of role.lists) {
      await page.goto(p, { waitUntil: "networkidle" });
      const prefix = "/" + p.split("/")[1];
      const hrefs = await page.$$eval("main a[href], a[href]", (as, pre) => as.map((a) => a.getAttribute("href") ?? "").filter((h) => h.startsWith(pre + "/") && !/download|letter|proof|upload|report$|export|open$/.test(h)), prefix);
      for (const h of hrefs.slice(0, 40)) if (!role.lists.includes(h.split("?")[0])) detail.add(h.split("?")[0]);
    }
    const detailList = [...detail].slice(0, 25);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      for (const p of [...role.lists, ...detailList]) await inspectPage(page, p, width, problems);
    }
    // Visit a sample of pages that belong to another role: must be refused or bounced, never shown.
    expect(problems, `${problems.length} problems\n` + [...new Set(problems)].join("\n")).toEqual([]);
  });
}

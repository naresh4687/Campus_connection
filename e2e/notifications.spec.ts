import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { loginAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const inDays = (d: number) => new Date(Date.now() + d * 86400_000 + 5.5 * 3600_000).toISOString().slice(0, 16);

test.describe.serial("in-app notifications", () => {
  let officer: Page; let student: Page;
  const open: Page[] = [];
  const newPage = async (b: Browser, who: string) => { const p = await (await b.newContext()).newPage(); open.push(p); await loginAs(p, who); return p; };
  const unread = async (p: Page) => { const el = p.getByTestId("unread-count"); return (await el.count()) ? Number(await el.innerText()) : 0; };

  async function publishDrive(title: string) {
    await officer.goto("/placement/drives/new");
    await officer.getByLabel("Company", { exact: true }).fill("Notify Test Co");
    await officer.getByLabel("Job title").fill(title);
    await officer.getByLabel("Employment type").selectOption("FULL_TIME");
    await officer.getByLabel("Openings").fill("2");
    await officer.getByLabel("Application deadline (IST)").fill(inDays(9));
    await officer.getByLabel("REG").check();
    await officer.getByLabel("2026", { exact: true }).check();
    await officer.getByRole("button", { name: "Create draft" }).click();
    await officer.waitForURL(/\/placement\/drives\/[0-9a-f-]{36}\?created=1$/);
    await officer.getByRole("button", { name: "Publish drive" }).click();
    await expect(officer.getByText("Drive published.")).toBeVisible();
  }

  test.beforeAll(async ({ browser }) => { officer = await newPage(browser, "offerOfficer"); student = await newPage(browser, "ntfA"); });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("setup: a company; the student starts with an empty or read inbox", async () => {
    await officer.goto("/placement/companies/new");
    await officer.getByLabel("Company name", { exact: true }).fill("Notify Test Co");
    await officer.getByRole("button", { name: "Add company" }).click();
    await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}\?created=1$/);
    await student.goto("/notifications");
    await expect(student.getByRole("heading", { name: "Notifications" })).toBeVisible();
  });

  test("publishing a drive notifies the matching student: the bell counts it, the inbox lists it, opening it marks it read and goes to the drive", async () => {
    await student.goto("/student");
    const before = await unread(student);
    await publishDrive("Notify Role One");
    await student.reload();
    expect(await unread(student)).toBe(before + 1);
    await student.goto("/notifications");
    const item = student.getByRole("list", { name: "Notifications" }).getByRole("listitem").filter({ hasText: "Notify Role One" });
    await expect(item).toContainText("Unread");
    await expect(item).toContainText("New placement drives");
    await item.getByRole("link", { name: /New placement drive: Notify Role One/ }).click();
    await student.waitForURL(/\/student\/drives\/[0-9a-f-]{36}$/);
    await expect(student.getByRole("heading", { name: "Notify Role One" })).toBeVisible();
    expect(await unread(student)).toBe(before);
    await student.goto("/notifications");
    await expect(student.getByRole("listitem").filter({ hasText: "Notify Role One" })).not.toContainText("Unread");
  });

  test("preferences: a category can be turned off (and then no new notification arrives); offers and placement are always on", async () => {
    await student.goto("/notifications/preferences");
    await expect(student.getByText("Always on")).toHaveCount(2);                                      // OFFERS and PLACEMENT
    await expect(student.getByRole("button", { name: /Turn (off|on) Selections and offers/ })).toHaveCount(0);
    await student.getByRole("button", { name: "Turn off New placement drives" }).click();
    await expect(student.getByRole("button", { name: "Turn on New placement drives" })).toBeVisible();
    await student.goto("/student");
    const before = await unread(student);
    await publishDrive("Notify Role Two");
    await student.reload();
    expect(await unread(student)).toBe(before);                                                         // muted
    await student.goto("/notifications");
    await expect(student.getByText("Notify Role Two")).toHaveCount(0);
    await student.goto("/notifications/preferences");
    await student.getByRole("button", { name: "Turn on New placement drives" }).click();
    await expect(student.getByRole("button", { name: "Turn off New placement drives" })).toBeVisible();
    await student.reload();
    await expect(student.getByRole("button", { name: "Turn off New placement drives" })).toBeVisible();   // persisted
    await publishDrive("Notify Role Three");
    await student.goto("/notifications");
    await expect(student.getByRole("listitem").filter({ hasText: "Notify Role Three" })).toContainText("Unread");
  });

  test("mark all as read clears the bell; other people's notifications cannot be opened; anonymous visitors go to login", async () => {
    await student.goto("/notifications");
    const href = (await student.getByRole("list", { name: "Notifications" }).getByRole("link").first().getAttribute("href"))!;
    expect(href).toMatch(/^\/notifications\/[0-9a-f-]{36}\/open$/);
    expect((await officer.request.get(href, { maxRedirects: 0, failOnStatusCode: false })).status()).toBe(404);   // not the officer's notification
    const anon = await (await student.context().browser()!.newContext()).request.get(href, { maxRedirects: 0, failOnStatusCode: false });
    expect(anon.status()).toBe(303); expect(anon.headers().location).toContain("/login");
    await student.getByRole("button", { name: "Mark all as read" }).click();
    await expect(student.getByText("All notifications marked as read.")).toBeVisible();
    expect(await unread(student)).toBe(0);
    await expect(student.getByText("Unread", { exact: true })).toHaveCount(0);
  });

  test("the inbox and preferences are accessible and fit a phone", async () => {
    for (const url of ["/notifications", "/notifications/preferences"]) {
      await student.goto(url);
      const a11y = await new AxeBuilder({ page: student }).withTags(TAGS).analyze();
      expect(a11y.violations.map((v) => `${url}: ${v.id} ${v.nodes.length}`)).toEqual([]);
    }
    await student.setViewportSize({ width: 360, height: 800 });
    for (const url of ["/notifications", "/notifications/preferences"]) {
      await student.goto(url); await student.waitForLoadState("networkidle");
      const o = await student.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(o.scroll, url).toBeLessThanOrEqual(o.inner);
    }
  });

  test("platform administrators have no notifications link", async ({ browser }) => {
    const p = await newPage(browser, "platform");
    await expect(p.getByRole("link", { name: /^Notifications/ })).toHaveCount(0);
  });
});

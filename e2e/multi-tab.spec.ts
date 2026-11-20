import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { expectOn, expectOnSignIn, seed } from "./helpers";
import { LOGIN_PATH, portalOfRole } from "../src/lib/portals";

/*
 * Independent sessions per role in ONE browser (one context = one cookie jar, shared by all its tabs). Each tab signs in
 * as a different role; none of them may change another. These are the seven scenarios of the multi-tab bug report.
 */
const ROLE_OF: Record<string, string> = { platform: "PLATFORM_SUPER_ADMIN", tabAdmin: "COLLEGE_ADMIN", tabOfficer: "PLACEMENT_OFFICER", tabStudent: "STUDENT" };
const HOME: Record<string, string> = { platform: "/platform", tabAdmin: "/college", tabOfficer: "/placement", tabStudent: "/student" };
const LABEL: Record<string, string> = { platform: "Platform administrator", tabAdmin: "College administrator", tabOfficer: "Placement officer", tabStudent: "Student" };

async function signInTab(ctx: BrowserContext, key: string): Promise<Page> {
  const s = seed(); const tab = await ctx.newPage();
  await tab.goto(LOGIN_PATH[portalOfRole(ROLE_OF[key])!]);
  await tab.getByLabel("Email").fill(s.users[key]); await tab.getByLabel("Password").fill(s.password[key]);
  await tab.getByRole("button", { name: "Sign in" }).click();
  await expectOn(tab, HOME[key]);
  return tab;
}
const isAs = async (tab: Page, key: string) => {
  await expect(tab.getByRole("banner").getByText(LABEL[key], { exact: true })).toBeVisible();
  if (key !== "platform") await expect(tab.getByRole("banner").getByText(`Test ${key}`, { exact: true })).toBeVisible();   // that tab's own user, by name
};

test.describe.serial("several roles signed in side by side in one browser", () => {
  test.setTimeout(120_000);
  let ctx: BrowserContext;
  const tabs: Record<string, Page> = {};
  test.beforeAll(async ({ browser }) => { ctx = await browser.newContext(); });
  test.afterAll(async () => { await ctx.close(); });

  test("TEST 1 and 2: platform admin, college admin, placement officer and student each stay signed in in their own tab", async () => {
    for (const key of ["platform", "tabAdmin", "tabOfficer", "tabStudent"]) tabs[key] = await signInTab(ctx, key);
    for (const key of Object.keys(tabs)) { await tabs[key].goto(HOME[key]); await expectOn(tabs[key], HOME[key]); await isAs(tabs[key], key); }
  });

  test("TEST 3: refreshing every tab restores that tab's own user", async () => {
    for (const key of Object.keys(tabs)) { await tabs[key].reload(); await expectOn(tabs[key], HOME[key]); await isAs(tabs[key], key); }
  });

  test("TEST 5: switching between tabs and navigating many times never changes a tab's role", async () => {
    const walk: Record<string, string[]> = { platform: ["/platform/colleges", "/platform/audit"], tabAdmin: ["/college/students", "/college/staff"], tabOfficer: ["/placement/drives", "/placement/companies"], tabStudent: ["/student/drives", "/student/academics"] };
    for (let round = 0; round < 3; round++) {
      for (const key of Object.keys(tabs)) {
        await tabs[key].bringToFront();
        for (const path of walk[key]) { await tabs[key].goto(path); await expectOn(tabs[key], path); await isAs(tabs[key], key); }
      }
    }
    // Shared pages carry their role: each tab's Account page shows that tab's user.
    for (const key of Object.keys(tabs)) {
      await tabs[key].goto(HOME[key]);
      await tabs[key].getByRole("link", { name: "Account" }).first().click();
      await isAs(tabs[key], key);
    }
  });

  test("TEST 6: a role's pages are refused to the others (server-side); nobody is switched into another role", async () => {
    // The coordinator role is not signed in anywhere in this browser: its pages ask for its sign-in, whatever else is open.
    await tabs.tabOfficer.goto("/coordinator");
    await expectOnSignIn(tabs.tabOfficer, "college");
    await tabs.tabOfficer.goto("/placement");
    await expectOn(tabs.tabOfficer, "/placement");                                           // and it is still the officer
    // A request carrying only the student's cookie to a staff export is refused by the server.
    const studentOnly = await ctx.browser()!.newContext();
    const sc = (await ctx.cookies()).find((c) => c.name === "cc_session_student")!;
    await studentOnly.addCookies([{ name: "cc_session_student", value: sc.value, url: "http://127.0.0.1:3100" }]);
    const res = await studentOnly.request.get("/reports/export/placed", { failOnStatusCode: false });
    expect(res.status()).toBe(403);
    const page = await studentOnly.newPage(); await page.goto("/placement"); await expectOnSignIn(page, "college");
    await studentOnly.close();
    // The other tabs are untouched.
    for (const key of ["tabAdmin", "tabStudent", "platform"]) { await tabs[key].goto(HOME[key]); await isAs(tabs[key], key); }
  });

  test("TEST 7: one role's session ending (expiry or removal) does not end or replace any other", async () => {
    const keep = (await ctx.cookies()).filter((c) => c.name !== "cc_session_placement");
    await ctx.clearCookies(); await ctx.addCookies(keep);                                     // the officer's session is gone, as if it expired
    await tabs.tabOfficer.goto("/placement");
    await expectOnSignIn(tabs.tabOfficer, "college");
    for (const key of ["platform", "tabAdmin", "tabStudent"]) { await tabs[key].reload(); await expectOn(tabs[key], HOME[key]); await isAs(tabs[key], key); }
  });

  test("TEST 4: the college administrator signs out; the student, the platform admin (and nothing else) stay signed in", async () => {
    await tabs.tabAdmin.goto("/college");
    await tabs.tabAdmin.getByRole("button", { name: "Sign out" }).first().click();
    await expectOnSignIn(tabs.tabAdmin, "college");
    await tabs.tabAdmin.goto("/college");
    await expectOnSignIn(tabs.tabAdmin, "college");                                          // really signed out, not switched to another role
    for (const key of ["tabStudent", "platform"]) { await tabs[key].reload(); await expectOn(tabs[key], HOME[key]); await isAs(tabs[key], key); }
  });
});

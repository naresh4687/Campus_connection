import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";
import { expectOn, expectOnSignIn, formAlert, seed } from "./helpers";

// Each kind of user has their own sign-in page (src/lib/portals.ts). pageStudent / pageStaff exist only for this spec,
// because wrong-page attempts count towards each account's sign-in limit.
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function tryOn(page: import("@playwright/test").Page, path: string, key: string) {
  const s = seed();
  await page.goto(path);
  await page.getByLabel("Email").fill(s.users[key]);
  await page.getByLabel("Password").fill(s.password[key]);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe("separate sign-in pages", () => {
  test("/login lets visitors choose student or college staff, and never mentions the platform page", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Student/ })).toHaveAttribute("href", "/login/student");
    await expect(page.getByRole("link", { name: /^College staff/ })).toHaveAttribute("href", "/login/college");
    expect(await page.content()).not.toContain("/admin/login");
    expect((await new AxeBuilder({ page }).withTags(TAGS).analyze()).violations.map((v) => v.id)).toEqual([]);
  });

  test("each page names who it is for", async ({ page }) => {
    for (const [path, heading] of [["/login/student", "Student sign in"], ["/login/college", "College staff sign in"], ["/admin/login", "Platform administrator sign in"]]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: heading }), path).toBeVisible();
    }
    expect(await page.locator('meta[name="robots"]').getAttribute("content")).toContain("noindex"); // the platform page stays out of search engines
  });

  test("a student on the staff page is not signed in, and is pointed to the student page", async ({ page }) => {
    await tryOn(page, "/login/college", "pageStudent");
    await expect(formAlert(page)).toContainText("Students sign in on the student page.");
    await expectOn(page, "/login/college");
    await page.getByRole("link", { name: "Go to that page" }).click();
    await expectOn(page, "/login/student");
    await page.goto("/student");
    await expectOnSignIn(page);                                                           // no session was created
  });

  test("staff on the student page are not signed in, and are pointed to the staff page", async ({ page }) => {
    await tryOn(page, "/login/student", "pageStaff");
    await expect(formAlert(page)).toContainText("Staff sign in on the college staff page.");
    await expect(page.getByRole("link", { name: "Go to that page" })).toHaveAttribute("href", "/login/college");
  });

  test("the platform page accepts only the platform administrator, and says nothing more to anyone else", async ({ page }) => {
    await tryOn(page, "/admin/login", "pageStaff");
    await expect(formAlert(page)).toHaveText("Invalid email or password.");
    await tryOn(page, "/login/college", "platform");                                         // and the administrator cannot use the college page
    await expect(formAlert(page)).toHaveText("Invalid email or password.");
    await tryOn(page, "/admin/login", "platform");
    await expectOn(page, "/platform");
  });

  test("each kind of user signs in on their own page", async ({ browser }) => {
    for (const [key, path, home] of [["pageStudent", "/login/student", "/student"], ["pageStaff", "/login/college", "/placement"]]) {
      const ctx = await browser.newContext(); const page = await ctx.newPage();
      await tryOn(page, path, key);
      await expectOn(page, home);
      await ctx.close();
    }
  });
});

test.describe("theme button", () => {
  test("one button switches between light and dark, and the choice is remembered", async ({ page, context }) => {
    await page.goto("/");
    const button = page.getByRole("button", { name: "Dark theme" }).first();
    await expect(page.getByRole("group", { name: "Theme" })).toHaveCount(0);               // the old three-button group is gone
    await expect(button).toHaveAttribute("aria-pressed", "false");
    await button.click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    expect((await context.cookies()).find((c) => c.name === "cc-theme")?.value).toBe("dark");
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");              // rendered dark by the server
    await page.getByRole("button", { name: "Dark theme" }).first().click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  });
});

// One browser, several areas: a student and a staff member can be signed in side by side (one cookie per area).
test.describe("one account per area in the same browser", () => {
  const role = (page: import("@playwright/test").Page, label: string) => page.getByRole("banner").getByText(label, { exact: true });

  test("a student and a staff member stay signed in in two tabs, shared pages follow ?as=, and signing out one keeps the other", async ({ browser }) => {
    const ctx = await browser.newContext();
    const studentTab = await ctx.newPage(); const staffTab = await ctx.newPage();
    await tryOn(studentTab, "/login/student", "pageStudent"); await expectOn(studentTab, "/student");
    await tryOn(staffTab, "/login/college", "pageStaff"); await expectOn(staffTab, "/placement");

    await studentTab.reload();                                                                // the first tab did not switch accounts
    await expectOn(studentTab, "/student");
    await expect(role(studentTab, "Student")).toBeVisible();
    await staffTab.goto("/placement/drives");
    await expect(role(staffTab, "Placement officer")).toBeVisible();

    await studentTab.getByRole("link", { name: "Account" }).first().click();                  // shared page, opened from the student's area
    await expect(studentTab).toHaveURL(/\/account\?as=student$/);
    await expect(role(studentTab, "Student")).toBeVisible();
    await staffTab.goto("/account?as=placement");
    await expect(role(staffTab, "Placement officer")).toBeVisible();

    await staffTab.goto("/placement");
    await staffTab.getByRole("button", { name: "Sign out" }).first().click();
    await expectOnSignIn(staffTab, "college");                                               // back to the staff sign-in page, not switched to the student
    await staffTab.goto("/placement");
    await expectOnSignIn(staffTab, "college");                                               // the staff area stays signed out
    await studentTab.goto("/student/drives");
    await expect(role(studentTab, "Student")).toBeVisible();                                  // the student is untouched
    await ctx.close();
  });

  test("a cookie only counts for its own area: a student's session copied into the staff cookie is refused", async ({ browser }) => {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await tryOn(page, "/login/student", "pageStudent"); await expectOn(page, "/student");
    const student = (await ctx.cookies()).find((c) => c.name === "cc_session_student")!;
    await ctx.clearCookies();
    await ctx.addCookies([{ name: "cc_session_college", value: student.value, url: "http://127.0.0.1:3100" }]);
    await page.goto("/placement");
    await expectOnSignIn(page);
    await ctx.close();
  });

  test("the area header cannot be chosen by the client", async ({ browser }) => {
    const ctx = await browser.newContext(); const page = await ctx.newPage();
    await tryOn(page, "/login/student", "pageStudent"); await expectOn(page, "/student");
    await ctx.setExtraHTTPHeaders({ "x-cc-portal": "college" });                              // forged: claims the staff area
    await page.goto("/account?as=student");
    await expect(role(page, "Student")).toBeVisible();
    await page.goto("/placement");
    await expectOnSignIn(page, "college");                                                   // still only the student is signed in
    await ctx.close();
  });
});

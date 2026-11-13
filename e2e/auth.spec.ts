import { expect, test } from "@playwright/test";
import { expectOn, formAlert, loginAs, seed, signIn } from "./helpers";

const PORTALS = [
  ["platform", "/platform", "Platform overview", "Platform administrator"],
  ["adminA", "/college", "College dashboard", "College administrator"],
  ["officerA", "/placement", "Placement overview", "Placement officer"],
  ["coordA", "/coordinator", "Department dashboard", "Department coordinator"],
  ["studentA", "/student", "Student dashboard", "Student"],
] as const;

test.describe("sign in lands each role in its own portal", () => {
  for (const [key, path, heading, label] of PORTALS) {
    test(`${key} -> ${path}`, async ({ page }) => {
      await signIn(page, key);
      await expectOn(page, path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.getByRole("banner").getByText(label, { exact: true })).toBeVisible();
    });
  }
});

test("the public home page renders for anonymous visitors", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1, name: "One place for the whole campus placement process" })).toBeVisible();
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expectOn(page, "/login");
});

test.describe("sign in failures are generic", () => {
  test("wrong password and unknown email give the same message", async ({ page }) => {
    await signIn(page, "studentA", "definitely-wrong-password");
    const wrong = await formAlert(page).innerText();
    await page.goto("/login/college");
    await page.getByLabel("Email").fill("nobody-here@e2e.test");
    await page.getByLabel("Password").fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(formAlert(page)).toHaveText(wrong);
    expect(wrong).toBe("Invalid email or password.");
    await expect(page.getByLabel("Email")).toHaveValue("nobody-here@e2e.test"); // email kept, password cleared
    await expect(page.getByLabel("Password")).toHaveValue("");
    await expectOn(page, "/login");
  });

  test("repeated failures for one account are rate limited, and even the right password is then refused", async ({ page }) => {
    for (let i = 0; i < 8; i++) {
      await signIn(page, "lockme", `wrong-password-${i}`);
      await expect(formAlert(page)).toHaveText("Invalid email or password.");
    }
    await signIn(page, "lockme"); // correct password, but the limit is exhausted
    await expect(formAlert(page)).toContainText("Too many attempts");
    await expectOn(page, "/login");
  });
});

test.describe("route protection", () => {
  for (const path of ["/platform", "/college", "/placement", "/coordinator", "/student", "/account"]) {
    test(`anonymous ${path} -> /login`, async ({ page }) => {
      await page.goto(path);
      await expectOn(page, "/login");
    });
  }

  test("a signed-in user is sent back to their own portal when they open another role's", async ({ page }) => {
    await loginAs(page, "studentA");
    for (const other of ["/platform", "/college", "/placement", "/coordinator"]) {
      await page.goto(other);
      await expectOn(page, "/student");
    }
    await page.context().clearCookies();
    await loginAs(page, "adminA");
    await page.goto("/platform");
    await expectOn(page, "/college");
    await page.goto("/placement");
    await expectOn(page, "/college");
  });

  test("an already signed-in user visiting /login or / is redirected home", async ({ page }) => {
    await loginAs(page, "officerA");
    await page.goto("/login");
    await expectOn(page, "/placement");
    await page.goto("/");
    await expectOn(page, "/placement");
  });
});

test.describe("session cookie", () => {
  test("is HttpOnly, SameSite=Lax, path=/, and invisible to page scripts", async ({ page, context }) => {
    await signIn(page, "studentA");
    await expectOn(page, "/student");
    const c = (await context.cookies()).find((x) => x.name === "cc_session")!;
    expect(c).toBeDefined();
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
    expect(c.path).toBe("/");
    expect(c.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await page.evaluate(() => document.cookie)).not.toContain("cc_session");
  });

  test("a forged or random cookie value is not a session", async ({ page, context }) => {
    await context.addCookies([{ name: "cc_session", value: "A".repeat(43), url: "http://127.0.0.1:3100" }]);
    await page.goto("/student");
    await expectOn(page, "/login");
    await context.addCookies([{ name: "cc_session", value: "%27%20OR%201%3D1--", url: "http://127.0.0.1:3100" }]);
    await page.goto("/student");
    await expectOn(page, "/login");
  });
});

test.describe("sign out", () => {
  test("ends the session server-side: the old cookie stops working", async ({ page, context }) => {
    await signIn(page, "studentA");
    await expectOn(page, "/student");
    const before = (await context.cookies()).find((x) => x.name === "cc_session")!;
    await page.getByRole("button", { name: "Sign out" }).click();
    await expectOn(page, "/login");
    await page.goto("/student");
    await expectOn(page, "/login");
    // replay the captured cookie: it must be dead even though the browser still "has" it
    await context.addCookies([{ name: "cc_session", value: before.value, url: "http://127.0.0.1:3100" }]);
    await page.goto("/student");
    await expectOn(page, "/login");
  });
});

test.describe("security headers", () => {
  test("are present on pages", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBe("no-referrer");
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-powered-by"]).toBeUndefined();
  });
});

test.describe("forgot password is honest", () => {
  test("says email is not enabled and does not pretend to send anything", async ({ page }) => {
    await page.goto("/forgot-password");
    await expect(page.getByText("Email delivery is not enabled")).toBeVisible();
    await expect(page.getByRole("button")).toHaveCount(0);
  });
});

test.describe("invitation acceptance", () => {
  test("accept -> sign in -> student portal; the link then stops working", async ({ page }) => {
    const s = seed();
    await page.goto(`/accept-invite?token=${s.inviteToken}`);
    await expect(page.getByText("Northfield Institute of Technology")).toBeVisible();
    await expect(page.getByText("newcomer@e2e.test")).toBeVisible();

    await page.getByLabel("Full name").fill("New Comer");
    await page.getByLabel("Choose a password").fill("short");
    await page.getByLabel("Confirm password").fill("short");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/accept-invite/); // blocked by minLength / validation

    await page.getByLabel("Choose a password").fill("Newcomer-Passw0rd!");
    await page.getByLabel("Confirm password").fill("Different-Passw0rd!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(formAlert(page)).toHaveText("Passwords do not match.");

    // the name survives the failed attempt; secrets are deliberately cleared
    await expect(page.getByLabel("Full name")).toHaveValue("New Comer");
    await expect(page.getByLabel("Choose a password")).toHaveValue("");
    await page.getByLabel("Choose a password").fill("Newcomer-Passw0rd!");
    await page.getByLabel("Confirm password").fill("Newcomer-Passw0rd!");
    await page.getByRole("button", { name: "Create account" }).click();
    await expectOn(page, "/login\\?welcome=1");
    await expect(page.getByText("Your account is ready")).toBeVisible();

    await page.getByLabel("Email").fill("newcomer@e2e.test");
    await page.getByLabel("Password").fill("Newcomer-Passw0rd!");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expectOn(page, "/student"); // role came from the invitation, not from the form
    await expect(page.getByText("Welcome, New Comer.")).toBeVisible();

    await page.context().clearCookies();
    await page.goto(`/accept-invite?token=${s.inviteToken}`);
    await expect(page.getByText("invalid, already used, or has expired")).toBeVisible();
  });

  test("tampered, malformed and expired links show the same refusal", async ({ page }) => {
    const s = seed();
    for (const token of [s.expiredToken, "A".repeat(43), "nonsense", ""]) {
      await page.goto(`/accept-invite?token=${token}`);
      await expect(page.getByText("invalid, already used, or has expired")).toBeVisible();
      await expect(page.getByRole("button", { name: "Create account" })).toHaveCount(0);
    }
  });
});

test.describe("password reset by one-time link", () => {
  test("sets a new password, kills old sessions, and the link is single-use", async ({ page, browser }) => {
    const s = seed();
    const other = await browser.newContext();
    const oldSession = await other.newPage();
    await loginAs(oldSession, "resetme");
    await expectOn(oldSession, "/student");

    await page.goto(`/reset-password?token=${s.resetToken}`);
    await expect(page.getByText("resetme@e2e.test")).toBeVisible();
    await page.getByLabel("New password", { exact: true }).fill("Brand-New-Passw0rd!");
    await page.getByLabel("Confirm new password").fill("Brand-New-Passw0rd!");
    await page.getByRole("button", { name: "Set new password" }).click();
    await expectOn(page, "/login\\?reset=1");

    await oldSession.goto("/student");
    await expectOn(oldSession, "/login"); // previously signed-in session was revoked
    await other.close();

    await signIn(page, "resetme"); // old password no longer works
    await expect(formAlert(page)).toHaveText("Invalid email or password.");
    await loginAs(page, "resetme", "Brand-New-Passw0rd!");
    await expectOn(page, "/student");

    await page.context().clearCookies();
    await page.goto(`/reset-password?token=${s.resetToken}`);
    await expect(page.getByText("invalid, already used, or has expired")).toBeVisible();
  });
});

test.describe("change own password", () => {
  test("requires the current password, then signs out other sessions but keeps this one", async ({ page, browser }) => {
    const s = seed();
    const second = await browser.newContext();
    const other = await second.newPage();
    await loginAs(other, "changepw");
    await expectOn(other, "/student");

    await loginAs(page, "changepw");
    await page.goto("/account");
    await page.getByLabel("Current password").fill("not-my-password");
    await page.getByLabel("New password", { exact: true }).fill("Changed-Passw0rd!1");
    await page.getByLabel("Confirm new password").fill("Changed-Passw0rd!1");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(formAlert(page)).toHaveText("Your current password is incorrect.");

    await expect(page.getByLabel("Current password")).toHaveValue(""); // secrets are cleared after an error
    await page.getByLabel("Current password").fill(s.password.changepw);
    await page.getByLabel("New password", { exact: true }).fill("Changed-Passw0rd!1");
    await page.getByLabel("Confirm new password").fill("Changed-Passw0rd!1");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page.locator('[role="status"]')).toContainText("Password changed");

    await page.goto("/student");
    await expectOn(page, "/student"); // this session survived
    await other.goto("/student");
    await expectOn(other, "/login"); // the other one did not
    await second.close();
  });
});

test("health endpoint still reports ok and leaks nothing", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(await res.json()).toEqual({ status: "ok" });
});

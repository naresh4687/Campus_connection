import { expect, test } from "@playwright/test";
import { expectOn, expectOnSignIn, formAlert, loginAs, seed, signIn } from "./helpers";

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
  await expect(page.getByRole("heading", { level: 1, name: "Every placement, on record." })).toBeVisible();
  await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
  await expectOnSignIn(page);
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
    await expectOn(page, "/login/college");                                      // still on the sign-in page, not signed in
  });

  test("repeated failures for one account are rate limited, and even the right password is then refused", async ({ page }) => {
    for (let i = 0; i < 8; i++) {
      await signIn(page, "lockme", `wrong-password-${i}`);
      await expect(formAlert(page)).toHaveText("Invalid email or password.");
    }
    await signIn(page, "lockme"); // correct password, but the limit is exhausted
    await expect(formAlert(page)).toContainText("Too many attempts");
    await expectOn(page, "/login/student");
  });
});

test.describe("route protection", () => {
  for (const [path, area] of [["/platform", "platform"], ["/college", "college"], ["/placement", "college"], ["/coordinator", "college"], ["/student", "student"], ["/account", undefined]] as const) {
    test(`anonymous ${path} -> ${area ?? "the"} sign-in page`, async ({ page }) => {
      await page.goto(path);
      if (area) await expectOnSignIn(page, area); else await expectOn(page, "/login");
    });
  }

  test("another role's pages ask for that role's sign-in; the signed-in role is never switched", async ({ page }) => {
    await loginAs(page, "studentA");
    await page.goto("/platform");
    await expectOnSignIn(page, "platform");                                    // never the student's dashboard, never another account
    for (const other of ["/college", "/placement", "/coordinator"]) {
      await page.goto(other);
      await expectOnSignIn(page, "college");
    }
    await page.goto("/student");
    await expectOn(page, "/student");                                         // the student is still signed in
    await page.context().clearCookies();
    await loginAs(page, "adminA");
    await page.goto("/platform");
    await expectOnSignIn(page, "platform");
    await page.goto("/placement");
    await expectOnSignIn(page, "college");                                    // the officer role is its own session too
  });

  test("a signed-in user visiting /login or a sign-in page is not redirected or shown earlier accounts; / stays the public page", async ({ page }) => {
    await loginAs(page, "officerA");
    for (const p of ["/login", "/login/college"]) {
      await page.goto(p);
      await expectOn(page, p);
      await expect(page.getByText(/Continue as|Already signed in/)).toHaveCount(0);
    }
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Every placement, on record." })).toBeVisible();
    await page.goto("/placement");
    await expectOn(page, "/placement");                                       // still signed in
  });
});

test.describe("session cookie", () => {
  test("is HttpOnly, SameSite=Lax, path=/, and invisible to page scripts", async ({ page, context }) => {
    await signIn(page, "studentA");
    await expectOn(page, "/student");
    const c = (await context.cookies()).find((x) => x.name === "cc_session_student")!;
    expect(c).toBeDefined();
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe("Lax");
    expect(c.path).toBe("/");
    expect(c.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await page.evaluate(() => document.cookie)).not.toContain("cc_session_student");
  });

  test("a forged or random cookie value is not a session", async ({ page, context }) => {
    await context.addCookies([{ name: "cc_session_student", value: "A".repeat(43), url: "http://127.0.0.1:3100" }]);
    await page.goto("/student");
    await expectOnSignIn(page);
    await context.addCookies([{ name: "cc_session_student", value: "%27%20OR%201%3D1--", url: "http://127.0.0.1:3100" }]);
    await page.goto("/student");
    await expectOnSignIn(page);
  });
});

test.describe("sign out", () => {
  test("ends the session server-side: the old cookie stops working", async ({ page, context }) => {
    await signIn(page, "studentA");
    await expectOn(page, "/student");
    const before = (await context.cookies()).find((x) => x.name === "cc_session_student")!;
    await page.getByRole("button", { name: "Sign out" }).click();
    await expectOnSignIn(page);
    await page.goto("/student");
    await expectOnSignIn(page);
    // replay the captured cookie: it must be dead even though the browser still "has" it
    await context.addCookies([{ name: "cc_session_student", value: before.value, url: "http://127.0.0.1:3100" }]);
    await page.goto("/student");
    await expectOnSignIn(page);
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
    await expect(page.getByRole("button", { name: /send|reset|submit/i })).toHaveCount(0); // nothing to press that would claim to send an email
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
    await expectOn(page, "/login/student\\?welcome=1");                  // invited as a student, so the student sign-in page
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
    await expectOn(page, "/login/student\\?reset=1");

    await oldSession.goto("/student");
    await expectOnSignIn(oldSession); // previously signed-in session was revoked
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

test.describe("change own password (by approval) and own name/email", () => {
  test("a student asks, a staff member approves, the student chooses a new password on the approved page; other sessions are signed out", async ({ page, browser }) => {
    const second = await browser.newContext(); const other = await second.newPage();
    await loginAs(other, "changepw"); await expectOn(other, "/student");
    const staffCtx = await browser.newContext(); const staff = await staffCtx.newPage(); await loginAs(staff, "pwOfficer");

    await loginAs(page, "changepw"); await page.goto("/account");
    await page.getByRole("button", { name: "Request a password change" }).click();
    await expect(page.getByText("Waiting for approval")).toBeVisible();
    await expect(page.getByLabel("Current password")).toHaveCount(1);                                        // only the profile form asks for it now; the password card does not

    await staff.goto("/account/password-requests");
    await staff.getByRole("listitem").filter({ hasText: "changepw@e2e.test" }).getByRole("button", { name: "Yes, approve" }).click();
    await expect(staff.getByText(/Approved\. They were notified/)).toBeVisible();

    await page.goto("/notifications"); await page.getByText("Password change approved").first().click();
    await expect(page).toHaveURL(/\/account\/password\/[0-9a-f-]{36}$/);
    await page.getByLabel("New password", { exact: true }).fill("Changed-Passw0rd!1"); await page.getByLabel("Confirm new password").fill("Different-Passw0rd!2");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(formAlert(page)).toHaveText("Passwords do not match.");
    await page.getByLabel("New password", { exact: true }).fill("Changed-Passw0rd!1"); await page.getByLabel("Confirm new password").fill("Changed-Passw0rd!1");
    await page.getByRole("button", { name: "Change password" }).click();
    await expect(page).toHaveURL(/\/account\?notice=password-changed/);
    await page.goto("/student"); await expectOn(page, "/student");                                           // this session survived
    await other.goto("/student"); await expectOnSignIn(other);                                               // the other one did not
    await page.goBack().catch(() => undefined);
    await second.close(); await staffCtx.close();
  });

  test("name and email change needs the current password; the new email is unique", async ({ page }) => {
    await loginAs(page, "profA"); await page.goto("/account");
    await page.getByLabel("Name", { exact: true }).fill("Renamed Student");
    await page.getByLabel(/^Current password/).first().fill("wrong-password-123");
    await page.getByRole("button", { name: "Save name and email" }).click();
    await expect(formAlert(page)).toHaveText("Your current password is incorrect.");
    await page.getByLabel(/^Current password/).first().fill(seed().password.profA);
    await page.getByLabel("Sign-in email").fill(seed().users.regA);                                          // already used by another account
    await page.getByRole("button", { name: "Save name and email" }).click();
    await expect(formAlert(page)).toHaveText("That email address is already used by another account.");
    await page.getByLabel("Sign-in email").fill(seed().users.profA);
    await page.getByRole("button", { name: "Save name and email" }).click();
    await expect(page.locator('[role="status"]')).toContainText("Saved");
    await page.reload(); await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Renamed Student");
  });
});

test("health endpoint still reports ok and leaks nothing", async ({ request }) => {
  const res = await request.get("/api/health");
  expect(await res.json()).toEqual({ status: "ok" });
});

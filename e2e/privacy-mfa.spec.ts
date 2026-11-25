import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { stepOf, totpAt } from "../src/lib/totp";
import { expectOn, formAlert, loginAs, seed, signIn } from "./helpers";

test.describe("two-step sign-in", () => {
  test("a staff member turns it on, then needs a code or a one-time recovery code to sign in", async ({ page }) => {
    await loginAs(page, "mfaStaff");
    await page.goto("/account");
    await page.getByRole("link", { name: "Manage two-step sign-in" }).click();
    await page.getByLabel("Your password").fill(seed().password.mfaStaff);
    await page.getByRole("button", { name: "Set up two-step sign-in" }).click();
    const secret = (await page.getByTestId("mfa-secret").innerText()).replace(/\s/g, "");
    await page.getByLabel("6-digit code").fill(totpAt(secret, stepOf(Date.now()) - 1));
    await page.getByRole("button", { name: "Turn it on" }).click();
    const items = page.getByRole("list", { name: "Recovery codes" }).getByRole("listitem");
    await expect(items).toHaveCount(10);
    const codes = await items.allInnerTexts();

    await page.context().clearCookies();
    await signIn(page, "mfaStaff");
    await expectOn(page, "/login/verify");
    await page.goto("/placement");
    await expect(page).not.toHaveURL(/\/placement$/);                       // the password alone gives no session
    await page.goto("/login/verify");
    await page.getByLabel("Code").fill("000000");
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expect(formAlert(page)).toContainText("not right");
    await page.getByLabel("Code").fill(totpAt(secret, stepOf(Date.now())));
    await page.getByRole("button", { name: "Verify and sign in" }).click();
    await expectOn(page, "/placement");

    for (const works of [true, false]) {
      await page.context().clearCookies();
      await signIn(page, "mfaStaff");
      await page.getByLabel("Code").fill(codes[0]);
      await page.getByRole("button", { name: "Verify and sign in" }).click();
      if (works) await expectOn(page, "/placement");
      else await expect(formAlert(page)).toContainText("already used");
    }
  });
});

test.describe("student data", () => {
  test("a student downloads their data and asks for deletion; the administrator approves and the account is gone", async ({ browser }) => {
    const student = await (await browser.newContext()).newPage();
    await loginAs(student, "eraseStudent");
    await student.goto("/student/privacy");
    const [download] = await Promise.all([student.waitForEvent("download"), student.getByRole("link", { name: "Download my data" }).click()]);
    const data = JSON.parse(readFileSync(await download.path(), "utf8"));
    expect(data.account.email).toBe(seed().users.eraseStudent.toLowerCase());
    await student.getByLabel("Your password").fill(seed().password.eraseStudent);
    await student.getByRole("button", { name: "Ask to delete my data" }).click();
    await expect(student.getByRole("button", { name: "Cancel my request" })).toBeVisible();

    const admin = await (await browser.newContext()).newPage();
    await loginAs(admin, "privacyAdmin");
    await admin.goto("/college/privacy");
    await admin.getByRole("button", { name: "Approve and erase" }).click();
    await expect(formAlert(admin)).toContainText("Tick the box");
    await admin.getByRole("checkbox").check();
    await admin.getByRole("button", { name: "Approve and erase" }).click();
    await expect(admin.getByRole("heading", { name: "Erased student" })).toBeVisible();

    await student.reload();
    await expect(student).toHaveURL(/\/login/);
    await signIn(student, "eraseStudent");
    await expect(formAlert(student)).toHaveText("Invalid email or password.");
  });
});

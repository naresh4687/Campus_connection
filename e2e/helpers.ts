import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

type Seed = { users: Record<string, string>; password: Record<string, string>; inviteToken: string; resetToken: string; expiredToken: string; zephyrRef: string; quartzRef: string };
export const seed = (): Seed => JSON.parse(readFileSync("e2e/.seed.json", "utf8"));

export async function signIn(page: Page, key: string, password?: string) {
  const s = seed();
  await page.goto("/login/college");
  await page.getByLabel("Email").fill(s.users[key]);
  await page.getByLabel("Password").fill(password ?? s.password[key]);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Sign in and wait until the redirect away from /login has completed (use before navigating elsewhere). */
export async function loginAs(page: Page, key: string, password?: string) {
  await signIn(page, key, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/login"));
}

/** The form's own error/status message (Next also renders an empty role=alert route announcer). */
export const formAlert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

export async function expectOn(page: Page, path: string) {
  await expect(page).toHaveURL(new RegExp(`${path}$`));
}

import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { LOGIN_PATH, type Portal } from "../src/lib/portals";

type Seed = { users: Record<string, string>; portal: Record<string, Portal>; password: Record<string, string>; inviteToken: string; resetToken: string; expiredToken: string; zephyrRef: string; quartzRef: string };
export const seed = (): Seed => JSON.parse(readFileSync("e2e/.seed.json", "utf8"));

export async function signIn(page: Page, key: string, password?: string) {
  const s = seed();
  await page.goto(LOGIN_PATH[s.portal[key]]);   // each kind of user has their own sign-in page
  await page.getByLabel("Email").fill(s.users[key]);
  await page.getByLabel("Password").fill(password ?? s.password[key]);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** Sign in and wait until the redirect away from the sign-in page has completed (use before navigating elsewhere). */
export async function loginAs(page: Page, key: string, password?: string) {
  await signIn(page, key, password);
  await page.waitForURL((u) => !u.pathname.startsWith("/login") && !u.pathname.startsWith("/admin/login"));
}

/** On a sign-in page: one area's (student / college / platform) when given, otherwise any of them or the /login chooser. Each area is independent, so
 *  "not signed in" lands on that area's own sign-in page. */
export async function expectOnSignIn(page: Page, area?: Portal) {
  await expect(page).toHaveURL(area ? new RegExp(`^https?://[^/]+${LOGIN_PATH[area]}(\\?.*)?$`) : /^https?:\/\/[^/]+(\/login(\/student|\/college)?|\/admin\/login)(\?.*)?$/);
}

/** The form's own error/status message (Next also renders an empty role=alert route announcer). */
export const formAlert = (page: Page) => page.locator('[role="alert"]:not(#__next-route-announcer__)');

/** The page's whole path (after the host) is `path` (a regex fragment). Anchored at both ends, so "/student" does not match "/login/student". */
export async function expectOn(page: Page, path: string) {
  await expect(page).toHaveURL(new RegExp(`^https?://[^/]+${path}$`));
}

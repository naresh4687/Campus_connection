import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { inspect } from "../db/tests/world";
import { loginAs, seed } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const inDays = (d: number) => new Date(Date.now() + d * 86400_000 + 5.5 * 3600_000).toISOString().slice(0, 16);

test.describe.serial("on-campus drive: create, attendance link, next round", () => {
  let officer: Page; let a: Page; let b: Page;
  const open: Page[] = [];
  let eventUrl = ""; let link = ""; let link2 = "";
  const nameOf = async (key: string) => (await inspect<{ full_name: string }>("SELECT full_name FROM students WHERE college_email = $1", [seed().users[key]]))[0].full_name;

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    officer = await (await browser.newContext()).newPage(); open.push(officer); await loginAs(officer, "campOfficer");
    for (const k of ["a", "b"]) { const p = await (await browser.newContext()).newPage(); open.push(p); if (k === "a") a = p; else b = p; }
  });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("the officer creates an on-campus drive for a new company with two rounds", async () => {
    await officer.goto("/placement/campus");
    await expect(officer.getByText("No on-campus drives yet")).toBeVisible();
    await officer.getByRole("link", { name: "Create an on-campus drive" }).first().click();
    await expect(officer.getByRole("heading", { name: "Create an on-campus drive" })).toBeVisible();
    const r = await new AxeBuilder({ page: officer }).withTags(TAGS).analyze(); expect(r.violations.map((v) => v.id)).toEqual([]);
    await officer.getByLabel("Company name").fill("Campus Visit Labs");
    await officer.getByLabel("Date and time (IST)").fill(inDays(3));
    await officer.getByLabel("Venue").fill("Seminar Hall");
    await officer.getByRole("button", { name: "Create on-campus drive" }).click();
    await officer.waitForURL(/\/placement\/campus\/[0-9a-f-]{36}\?notice=created$/);
    eventUrl = officer.url().split("?")[0];
    await expect(officer.getByText("Created. Open attendance for round 1")).toBeVisible();
    await expect(officer.getByRole("heading", { name: "Round 1: Aptitude test" })).toBeVisible();
    link = await officer.getByLabel("Attendance link").inputValue();
    expect(link).toMatch(/\/student\/campus\/attend\/[0-9a-f]{64}$/);
  });

  test("a signed-out student opening the link signs in and lands back on it; it is not open yet", async () => {
    await a.goto(link);
    await expect(a).toHaveURL(/\/login\/student\?next=%2Fstudent%2Fcampus%2Fattend%2F[0-9a-f]{64}$/);
    await a.getByLabel("Email").fill(seed().users.campA);
    await a.getByLabel("Password").fill(seed().password.campA);
    await a.getByRole("button", { name: "Sign in" }).click();
    await a.waitForURL(/\/student\/campus\/attend\/[0-9a-f]{64}$/);
    await expect(a.getByText("Attendance for this round has not opened yet")).toBeVisible();
    await expect(a.getByRole("button", { name: "Mark me present" })).toHaveCount(0);
  });

  test("a link cannot redirect anywhere else after sign-in", async ({ browser }) => {
    const p = await (await browser.newContext()).newPage();
    await p.goto("/login/student?next=https%3A%2F%2Fevil.example%2F");
    await p.getByLabel("Email").fill(seed().users.campB);
    await p.getByLabel("Password").fill(seed().password.campB);
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForURL((u) => u.pathname === "/student");
    await p.context().close();
  });

  test("the officer opens round 1; students mark themselves present once", async () => {
    await officer.goto(eventUrl);
    await officer.getByRole("button", { name: "Open attendance" }).click();
    await expect(officer.getByText("Attendance is open. Eligible students were notified.")).toBeVisible();
    await a.reload();
    await a.getByRole("button", { name: "Mark me present" }).click();
    await expect(a.getByText("You are marked present for this round.")).toBeVisible();
    await a.reload();
    await expect(a.getByText("You are marked present for this round.")).toBeVisible();
    // The second student signs in by the link and marks too; it shows in the student's own list as well.
    await loginAs(b, "campB");
    await b.goto(link);
    await b.getByRole("button", { name: "Mark me present" }).click();
    await expect(b.getByText("You are marked present for this round.")).toBeVisible();
    await b.goto("/student/campus");
    await expect(b.getByRole("heading", { name: "Campus Visit Labs" })).toBeVisible();
    await expect(b.getByText("Present", { exact: true })).toBeVisible();
    await b.goto("/notifications");
    await expect(b.getByText("Attendance open: Aptitude test")).toBeVisible();
  });

  test("the officer sees both, marks one eligible for round 2, and only that student can attend it", async () => {
    await officer.goto(eventUrl);
    const nameA = await nameOf("campA");
    const row = officer.getByRole("row").filter({ hasText: nameA });
    await expect(officer.getByRole("heading", { name: "Who attended round 1 (2)" })).toBeVisible();
    await row.getByRole("checkbox").check();
    await officer.getByRole("button", { name: "Mark eligible for round 2" }).click();
    await expect(officer.getByText("1 student marked eligible for the next round.")).toBeVisible();
    await expect(officer.getByRole("row").filter({ hasText: nameA }).getByText("Eligible", { exact: true })).toBeVisible();
    // Round 2 cannot open before anyone is eligible, and can once someone is.
    await officer.goto(`${eventUrl}?round=2`);
    link2 = await officer.getByLabel("Attendance link").inputValue();
    await officer.getByRole("button", { name: "Open attendance" }).click();
    await expect(officer.getByText("Attendance is open. Eligible students were notified.")).toBeVisible();
    await a.goto(link2);
    await a.getByRole("button", { name: "Mark me present" }).click();
    await expect(a.getByText("You are marked present for this round.")).toBeVisible();
    await b.goto(link2);
    await expect(b.getByText("You are not on the list for this round.")).toBeVisible();
    await expect(b.getByRole("button", { name: "Mark me present" })).toHaveCount(0);
    await a.goto("/notifications");
    await expect(a.getByText("You are eligible for the next round")).toBeVisible();
  });

  test("a closed round refuses new check-ins; the list page and the event pages are accessible", async () => {
    await officer.goto(`${eventUrl}?round=2`);
    await officer.getByRole("button", { name: "Close attendance" }).click();
    await expect(officer.getByText("Attendance closed.", { exact: true })).toBeVisible();
    await expect(officer.getByRole("button", { name: "Reopen attendance" })).toBeEnabled();   // the toggle has finished updating
    await officer.mouse.move(0, 0); await officer.waitForTimeout(400);   // let the hover transition on the toggle button finish before measuring contrast
    for (const p of [officer]) { const r = await new AxeBuilder({ page: p }).withTags(TAGS).analyze(); expect(r.violations.map((v) => v.id)).toEqual([]); }
    await a.goto("/student/campus");
    const r = await new AxeBuilder({ page: a }).withTags(TAGS).analyze(); expect(r.violations.map((v) => v.id)).toEqual([]);
    await officer.goto("/placement/campus");
    await expect(officer.getByRole("link", { name: "Campus Visit Labs" })).toBeVisible();
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { inspect } from "../db/tests/world";
import { loginAs, seed } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const inDays = (d: number) => new Date(Date.now() + d * 86400_000 + 5.5 * 3600_000).toISOString().slice(0, 16);
const regOf = async (key: string) => (await inspect<{ r: string }>("SELECT register_number::text AS r FROM students WHERE college_email = $1", [seed().users[key]]))[0].r;

test.describe.serial("registered and not registered students, reminders and downloads", () => {
  let officer: Page; let coord: Page; let a: Page; let b: Page; const open: Page[] = [];
  let driveId = ""; let regA = ""; let regB = "";
  const page = async (br: Browser, who: string) => { const p = await (await br.newContext()).newPage(); open.push(p); await loginAs(p, who); return p; };
  test.beforeAll(async ({ browser }) => { officer = await page(browser, "partOfficer"); coord = await page(browser, "partCoord"); a = await page(browser, "partA"); b = await page(browser, "partB"); regA = await regOf("partA"); regB = await regOf("partB"); });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("setup: a published drive; one student registers, another does not", async () => {
    await officer.goto("/placement/companies/new");
    await officer.getByLabel("Company name", { exact: true }).fill("Participation Test Corp");
    await officer.getByRole("button", { name: "Add company" }).click();
    await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}\?created=1$/);
    await officer.goto("/placement/drives/new");
    await officer.getByLabel("Company", { exact: true }).fill("Participation Test Corp");
    await officer.getByLabel("Job title").fill("Support Engineer");
    await officer.getByLabel("Employment type").selectOption("FULL_TIME");
    await officer.getByLabel("Openings").fill("5");
    await officer.getByLabel("Application deadline (IST)").fill(inDays(10));
    await officer.getByLabel("REG", { exact: true }).check(); await officer.getByLabel("2026", { exact: true }).check();
    await officer.getByRole("button", { name: "Create draft" }).click();
    await officer.waitForURL(/\/placement\/drives\/[0-9a-f-]{36}\?created=1$/);
    driveId = officer.url().split("?")[0].split("/").pop()!;
    await officer.getByRole("button", { name: "Publish drive" }).click(); await expect(officer.getByText("Drive published.")).toBeVisible();
    await a.goto(`/student/drives/${driveId}`); await a.getByRole("button", { name: "Register for this drive" }).click(); await expect(a.getByText("You are registered for this drive.")).toBeVisible();
  });

  test("the officer sees who registered and who did not, filtered by department, and can download the list", async () => {
    await officer.goto(`/placement/drives/${driveId}`);
    await officer.getByRole("link", { name: "Registered and not registered" }).click();
    await expect(officer.getByRole("heading", { name: "Registration status" })).toBeVisible();
    await expect(officer.getByRole("row", { name: new RegExp(regB) })).toBeVisible();                       // default view: eligible and not registered
    await expect(officer.getByRole("row", { name: new RegExp(regA) })).toHaveCount(0);
    await expect(officer.getByTestId("part-Registered")).not.toHaveText("0");
    await officer.getByLabel("Show").selectOption("registered"); await officer.getByRole("button", { name: "Apply filters" }).click();
    await expect(officer.getByRole("row", { name: new RegExp(regA) })).toBeVisible(); await expect(officer.getByRole("row", { name: new RegExp(regB) })).toHaveCount(0);
    await officer.getByLabel("Show").selectOption("not-registered");
    await officer.getByLabel("Department").selectOption({ label: "REG" }); await officer.getByRole("button", { name: "Apply filters" }).click();
    await expect(officer.getByRole("row", { name: new RegExp(regB) })).toBeVisible();
    const href = await officer.getByTestId("download-csv").getAttribute("href");
    const res = await officer.request.get(href!);
    expect(res.status()).toBe(200); expect(res.headers()["content-type"]).toContain("text/csv"); expect(res.headers()["content-disposition"]).toContain("attachment");
    const csv = await res.text(); expect(csv.split("\r\n")[0]).toContain("Register number"); expect(csv).toContain(regB); expect(csv).not.toContain(regA);
    expect(Number((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM audit_log WHERE action = 'DRIVE_PARTICIPATION_EXPORTED' AND entity_id = $1", [driveId]))[0].n)).toBe(1);
    const r = await new AxeBuilder({ page: officer }).withTags(TAGS).analyze(); expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test("a student cannot read the list or download it", async () => {
    for (const p of ["/placement/drives/" + driveId + "/participation", "/coordinator/drives/" + driveId]) { await b.goto(p); expect(new URL(b.url()).pathname).not.toBe(p); }
    expect([401, 403]).toContain((await b.request.get(`/placement/drives/${driveId}/participation/download`, { failOnStatusCode: false })).status());
  });

  test("the officer reminds the students who have not registered; one reminder per six hours", async () => {
    await officer.goto(`/placement/drives/${driveId}/participation`);
    await officer.getByRole("button", { name: "Remind students" }).click();
    await expect(officer.getByText("Tick the box to confirm that you want to send this reminder.")).toBeVisible();
    await officer.getByRole("checkbox", { name: "Send the reminder now." }).check(); await officer.getByRole("button", { name: "Remind students" }).click();
    await expect(officer.getByText(/Reminder sent to \d+ students?\./)).toBeVisible();
    await b.goto("/notifications"); await expect(b.getByText("Registration open: Support Engineer")).toBeVisible();
    await a.goto("/notifications"); await expect(a.getByText("Registration open: Support Engineer")).toHaveCount(0);       // already registered
    await officer.reload(); await officer.getByRole("checkbox", { name: "Send the reminder now." }).check(); await officer.getByRole("button", { name: "Remind students" }).click();
    await expect(officer.getByText(/already sent in the last 6 hours/)).toBeVisible();
  });

  test("the officer notifies the coordinators; the coordinator sees only their department and can download it", async () => {
    await officer.reload();
    await officer.getByRole("checkbox", { name: "Notify the coordinators now." }).check(); await officer.getByRole("button", { name: "Notify coordinators" }).click();
    await expect(officer.getByText(/\d+ coordinators? notified\./)).toBeVisible();
    await coord.goto("/notifications"); await expect(coord.getByText(/eligible students? of REG have not registered/).first()).toBeVisible();
    await coord.goto("/coordinator/drives");
    await coord.getByRole("link", { name: "Registration status" }).first().click();
    await expect(coord.getByRole("row", { name: new RegExp(regB) })).toBeVisible();
    await expect(coord.getByLabel("Department").locator("option")).toHaveCount(2);                          // "All my departments" and REG: no other department is offered
    await expect(coord.getByRole("button", { name: "Notify coordinators" })).toHaveCount(0);                // officers only
    const csv = await (await coord.request.get((await coord.getByTestId("download-csv").getAttribute("href"))!)).text();
    expect(csv).toContain(regB);
    await coord.getByRole("checkbox", { name: "Send the reminder now." }).check(); await coord.getByRole("button", { name: "Remind students" }).click();
    await expect(coord.getByText(/already sent in the last 6 hours/)).toBeVisible();                       // the officer's reminder covered every department
    const r = await new AxeBuilder({ page: coord }).withTags(TAGS).analyze(); expect(r.violations.map((v) => v.id)).toEqual([]);
    await coord.goto("/placement/drives"); expect(new URL(coord.url()).pathname).not.toBe("/placement/drives");
  });

  test("the student home leads with drives that are open and not registered, soonest deadline first; a registered student does not see it", async () => {
    await b.goto("/student");
    const band = b.getByRole("region", { name: /Open for you/ });
    const card = band.getByRole("listitem").filter({ hasText: "Participation Test Corp" });
    await expect(card).toContainText("Not registered yet"); await expect(card).toContainText("days left");
    await card.getByRole("link", { name: "View and register" }).click();
    await expect(b).toHaveURL(new RegExp(`/student/drives/${driveId}$`));
    await a.goto("/student");
    await expect(a.getByRole("region", { name: /Open for you/ }).getByRole("listitem").filter({ hasText: "Participation Test Corp" })).toHaveCount(0);   // registered: nothing left to do for it
  });
});

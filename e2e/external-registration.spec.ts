import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { inspect } from "../db/tests/world";
import { loginAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const inDays = (d: number) => new Date(Date.now() + d * 86400_000 + 5.5 * 3600_000).toISOString().slice(0, 16);
/** The smallest complete PNG the validator accepts (signature ... IEND). */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7), Buffer.from([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])]);
const LINK = "https://forms.example.test/zooye/apply";

test.describe.serial("external company registration with screenshot evidence", () => {
  let officer: Page; let coord: Page; let a: Page; let b: Page; let other: Page;
  const open: Page[] = [];
  let driveId = ""; let evidenceId = "";
  const page = async (br: Browser, who: string) => { const p = await (await br.newContext()).newPage(); open.push(p); await loginAs(p, who); return p; };
  test.beforeAll(async ({ browser }) => { officer = await page(browser, "extOfficer"); coord = await page(browser, "extCoord"); a = await page(browser, "extA"); b = await page(browser, "extB"); other = await page(browser, "extOfficerB"); });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("an officer creates a drive and sets external registration; it cannot be published until the link is confirmed", async () => {
    await officer.goto("/placement/companies/new");
    await officer.getByLabel("Company name", { exact: true }).fill("Zooye External Corp");
    await officer.getByRole("button", { name: "Add company" }).click();
    await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}\?created=1$/);
    await officer.goto("/placement/drives/new");
    await officer.getByLabel("Company", { exact: true }).fill("Zooye External Corp");
    await officer.getByLabel("Job title").fill("WordPress Developer");
    await officer.getByLabel("Employment type").selectOption("INTERNSHIP");
    await officer.getByLabel("Openings").fill("5");
    await officer.getByLabel("Application deadline (IST)").fill(inDays(10));
    await officer.getByLabel("REG", { exact: true }).check();
    await officer.getByLabel("2026", { exact: true }).check();
    await expect(officer.getByTestId("external-fields")).toHaveCount(0);                              // off by default: one-click registration
    await officer.getByRole("checkbox", { name: /This drive has an external registration link/ }).check();
    await officer.getByLabel("External registration link", { exact: true }).fill(LINK);
    await officer.getByLabel("Instructions for students (optional)").fill("Use your college email in the form.");
    await officer.getByRole("button", { name: "Create draft" }).click();
    await expect(officer.getByText("Tick the box to confirm the link and the screenshot step.")).toBeVisible();   // asked to confirm the screenshot step
    await expect(officer.getByLabel("External registration link", { exact: true })).toHaveValue(LINK);                                // nothing typed was lost
    await officer.getByRole("checkbox", { name: /I confirm this link is the company’s actual registration form/ }).check();
    await officer.getByRole("button", { name: "Create draft" }).click();
    await officer.waitForURL(/\/placement\/drives\/[0-9a-f-]{36}\?created=1$/);
    driveId = officer.url().split("?")[0].split("/").pop()!;
    expect((await inspect<{ registration_method: string; external_url: string; external_url_confirmed: boolean }>("SELECT registration_method, external_url, external_url_confirmed FROM drives WHERE id = $1", [driveId]))[0]).toEqual({ registration_method: "EXTERNAL", external_url: LINK, external_url_confirmed: true });
    await officer.getByRole("button", { name: "Publish drive" }).click();
    await expect(officer.getByText("Drive published.")).toBeVisible();
  });

  test("a student starts: the link is shown only after the eligibility check, opens safely in a new tab, and nothing is registered yet", async () => {
    await a.goto(`/student/drives/${driveId}`);
    await expect(a.getByText("Through the company’s website")).toBeVisible();
    await expect(a.getByRole("link", { name: /Open the company’s registration form/ })).toHaveCount(0);
    await a.getByRole("button", { name: "Register through company website" }).dblclick();
    await expect(a.getByTestId("external-pending")).toBeVisible();
    const link = a.getByRole("link", { name: /Open the company’s registration form/ });
    await expect(link).toHaveAttribute("href", LINK); await expect(link).toHaveAttribute("target", "_blank"); await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(a.getByText("External registration pending").first()).toBeVisible();
    const rows = await inspect<{ status: string; n: string }>("SELECT status, count(*)::text AS n FROM registrations WHERE drive_id = $1 GROUP BY status", [driveId]);
    expect(rows).toEqual([{ status: "PENDING_EXTERNAL", n: "1" }]);
    await a.goto("/student/drives"); await expect(a.getByText("External registration pending")).toBeVisible();      // coming back later finds it
    await a.goto(`/student/drives/${driveId}`); await expect(a.getByTestId("external-pending")).toBeVisible();
    const r = await new AxeBuilder({ page: a }).withTags(TAGS).analyze(); expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test("an invalid file is refused with a clear message and the registration stays pending; a real screenshot completes it", async () => {
    await a.goto(`/student/drives/${driveId}`);
    await a.getByLabel("Screenshot of the final confirmation page").setInputFiles({ name: "confirmation.png", mimeType: "image/png", buffer: Buffer.from("%PDF-1.4 not an image %%EOF") });
    await a.getByRole("button", { name: "Submit screenshot" }).click();
    await expect(a.getByText(/Upload a complete PNG, JPEG or WebP image/)).toBeVisible();
    await expect(a.getByTestId("external-pending")).toBeVisible();
    await a.getByLabel("Screenshot of the final confirmation page").setInputFiles({ name: "confirmation.png", mimeType: "image/png", buffer: PNG });
    await a.getByRole("button", { name: "Submit screenshot" }).click();
    await expect(a.getByText("Your external registration screenshot has been submitted successfully.").first()).toBeVisible();
    const st = a.getByTestId("external-status");
    await expect(st).toContainText("Registration status: REGISTERED"); await expect(st).toContainText("Awaiting verification");
    await expect(st).not.toContainText("verified successfully");
    await a.goto("/student/drives"); await expect(a.getByText("Registered — evidence pending review")).toBeVisible();
    const [{ id }] = await inspect<{ id: string }>("SELECT id FROM registration_evidence WHERE drive_id = $1", [driveId]); evidenceId = id;
    const files = await inspect<{ n: string }>("SELECT count(*)::text AS n FROM registration_evidence WHERE drive_id = $1", [driveId]); expect(files[0].n).toBe("1");
  });

  test("the department's coordinator sees it, must give a reason to reject, and the student is told what to do", async () => {
    await coord.goto("/coordinator/evidence");
    await expect(coord.getByText("Zooye External Corp — WordPress Developer")).toBeVisible();
    const r = await new AxeBuilder({ page: coord }).withTags(TAGS).analyze(); expect(r.violations.map((v) => v.id)).toEqual([]);
    await coord.getByRole("button", { name: "Reject" }).click();
    await expect(coord.getByText(/Give the student a reason/)).toBeVisible();
    await coord.getByLabel(/^Reason/).fill("The page is cropped; show the confirmation text.");
    await coord.getByRole("button", { name: "Reject" }).click();
    await expect(coord.getByText("Rejected. The student was told why.")).toBeVisible();
    await a.goto(`/student/drives/${driveId}`);
    await expect(a.getByTestId("external-action")).toContainText("Reason: The page is cropped; show the confirmation text.");
    await expect(a.getByText("Action required — upload a new screenshot").first()).toBeVisible();
    await a.goto("/notifications"); await expect(a.getByText("Screenshot not accepted")).toBeVisible();
  });

  test("the student replaces the screenshot without a second registration; the old version is kept; an officer verifies", async () => {
    await a.goto(`/student/drives/${driveId}`);
    await a.getByLabel("Upload a new screenshot").setInputFiles({ name: "again.png", mimeType: "image/png", buffer: PNG });
    await a.getByRole("button", { name: "Submit the new screenshot" }).click();
    await expect(a.getByTestId("external-status")).toContainText("Awaiting verification");
    const rows = await inspect<{ version: number; status: string }>("SELECT version, status FROM registration_evidence WHERE drive_id = $1 ORDER BY version", [driveId]);
    expect(rows).toEqual([{ version: 1, status: "SUPERSEDED" }, { version: 2, status: "SUBMITTED_PENDING_REVIEW" }]);
    expect((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM registrations WHERE drive_id = $1", [driveId]))[0].n).toBe("1");
    await officer.goto("/placement/evidence");
    await officer.getByRole("button", { name: "Mark verified" }).click();
    await expect(officer.getByText("Marked verified.")).toBeVisible();
    await a.goto("/student/drives"); await expect(a.getByText("Registered — evidence verified")).toBeVisible();
    await officer.goto(`/placement/drives/${driveId}`);
    await expect(officer.getByTestId("ext-Verified")).toHaveText("1"); await expect(officer.getByTestId("ext-Screenshots submitted")).toHaveText("1");
    await officer.goto(`/placement/drives/${driveId}/applicants`); await expect(officer.getByText("Registered — evidence verified")).toBeVisible();
  });

  test("screenshots are private: only the owner and permitted staff can open one; another student and another college cannot", async () => {
    const get = async (p: Page) => (await p.request.get(`/evidence/${evidenceId}/download`, { failOnStatusCode: false, maxRedirects: 0 })).status();
    expect(await get(a)).toBe(302); expect(await get(coord)).toBe(302); expect(await get(officer)).toBe(302);
    const loc = (await a.request.get(`/evidence/${evidenceId}/download`, { failOnStatusCode: false, maxRedirects: 0 })).headers()["location"];
    const signed = await fetch(loc); expect(signed.status).toBe(200); expect(Buffer.from(await signed.arrayBuffer()).equals(PNG)).toBe(true);     // the owner's short-lived link returns the file
    expect((await fetch(loc.split("?")[0])).status).toBeGreaterThanOrEqual(400);                                                                         // the same address without the signature is refused: the bucket is private
    expect([403, 404]).toContain(await get(b)); expect([403, 404]).toContain(await get(other));
    const anon = await (await (await a.context().browser()!.newContext()).request.get(`/evidence/${evidenceId}/download`, { failOnStatusCode: false, maxRedirects: 0 })).status();
    expect([303, 401, 403, 404]).toContain(anon);
    const looks = await inspect<{ n: string }>("SELECT count(*)::text AS n FROM audit_log WHERE action = 'EXTERNAL_EVIDENCE_VIEWED'"); expect(Number(looks[0].n)).toBeGreaterThanOrEqual(3);
    expect((await other.request.get(`/student/drives/${driveId}/evidence`, { failOnStatusCode: false })).status()).toBeGreaterThanOrEqual(400);   // an upload endpoint answers POST only
    await b.goto(`/student/drives/${driveId}`);
    await expect(b.getByRole("button", { name: "Register through company website" })).toBeVisible();   // a student who has not started sees no one else's evidence
    await expect(b.getByText("Your screenshots")).toHaveCount(0);
  });

  test("an internal drive is unchanged: one click registers", async () => {
    await officer.goto("/placement/drives/new");
    await officer.getByLabel("Company", { exact: true }).fill("Zooye External Corp");
    await officer.getByLabel("Job title").fill("Internal Role");
    await officer.getByLabel("Employment type").selectOption("FULL_TIME");
    await officer.getByLabel("Openings").fill("3");
    await officer.getByLabel("Application deadline (IST)").fill(inDays(9));
    await officer.getByLabel("REG", { exact: true }).check(); await officer.getByLabel("2026", { exact: true }).check();
    await officer.getByRole("button", { name: "Create draft" }).click();
    await officer.waitForURL(/\/placement\/drives\/[0-9a-f-]{36}\?created=1$/);
    const id = officer.url().split("?")[0].split("/").pop()!;
    await officer.getByRole("button", { name: "Publish drive" }).click(); await expect(officer.getByText("Drive published.")).toBeVisible();
    await b.goto(`/student/drives/${id}`);
    await expect(b.getByText("CampusConnect (one click)")).toBeVisible();
    await b.getByRole("button", { name: "Register for this drive" }).click();
    await expect(b.getByText("You are registered for this drive.")).toBeVisible();
  });

  test("the Placements page tells an officer where to select students and issue offers, with a link for each drive", async () => {
    await officer.goto("/placement/placements");
    const card = officer.locator("#manage-offers");
    await expect(card).toContainText("Manage selections and offers");
    await expect(card.getByRole("listitem").filter({ hasText: "WordPress Developer" }).getByRole("link", { name: "Selections and offers" })).toHaveAttribute("href", new RegExp(`/placement/drives/${driveId}/offers$`));
    await expect(officer.getByText("Choose a drive below → Select students.")).toBeVisible();
    await card.getByRole("listitem").filter({ hasText: "WordPress Developer" }).getByRole("link", { name: "Selections and offers" }).click();
    await expect(officer).toHaveURL(new RegExp(`/placement/drives/${driveId}/offers$`));
  });
});

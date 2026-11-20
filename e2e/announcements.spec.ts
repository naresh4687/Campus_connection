import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { closeAppDb, inspect } from "../db/tests/world";
import { loginAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const TITLE = `Cloud training venues ${Date.now()}`;

test.describe.serial("placement announcements (staff create and publish; students receive; coordinators are limited)", () => {
  let officer: Page; let coord: Page; let student: Page; let other: Page;
  let url = "";
  test.beforeAll(async ({ browser }) => {
    officer = await (await browser.newContext()).newPage(); await loginAs(officer, "annOfficer");
    coord = await (await browser.newContext()).newPage(); await loginAs(coord, "annCoord");
    student = await (await browser.newContext()).newPage(); await loginAs(student, "annA");
    other = await (await browser.newContext()).newPage(); await loginAs(other, "officerB");
  });
  test.afterAll(async () => { for (const p of [officer, coord, student, other]) await p.context().close(); await closeAppDb(); });

  test("an officer saves a training announcement as a draft with a venue per batch; nobody is notified", async () => {
    await officer.goto("/placement/announcements");
    await officer.getByRole("link", { name: "Create placement update" }).click();
    await officer.getByRole("link", { name: "Fill in the form myself" }).click();
    await officer.getByLabel("Type of announcement").selectOption("TRAINING_VENUE");
    await officer.getByLabel("Title").fill(TITLE);
    await officer.getByLabel("Company (optional)").fill("HCL");
    await officer.getByLabel(/^Batches and their venues/).fill("Batch 1 | CC1 and CC2\nBatch 2 | CC3 and CC4");
    await officer.getByLabel("Summary").fill("Report to your assigned classroom on time.");
    await officer.getByLabel("Original message (kept exactly as received)").fill("*Final Year Training – Venue Details*\nBatch 1: CC1 & CC2\nBatch 2: CC3 & CC4");
    await officer.getByRole("checkbox", { name: "REG" }).check();
    await officer.getByRole("button", { name: "Save draft" }).click();
    await officer.waitForURL(/\/placement\/announcements\/[0-9a-f-]{36}\?created=1/); url = officer.url().replace(/\?.*/, "");
    await expect(officer.getByText("Draft saved. Nobody has been notified.")).toBeVisible();
    const preview = officer.getByRole("article", { name: "Announcement" });
    await expect(preview.getByRole("row", { name: /Batch 1 CC1 and CC2/ })).toBeVisible();
    await expect(preview.getByRole("row", { name: /Batch 2 CC3 and CC4/ })).toBeVisible();
    const rows = await inspect<{ n: string }>("SELECT count(*)::text AS n FROM announcement_recipients r JOIN announcements a ON a.id = r.announcement_id WHERE a.title = $1", [TITLE]);
    expect(Number(rows[0].n)).toBe(0);
    await student.goto("/student/announcements");
    await expect(student.getByRole("link", { name: TITLE })).toHaveCount(0);
  });

  test("the editor page has no accessibility violations", async () => {
    await officer.goto(url);
    const r = await new AxeBuilder({ page: officer }).withTags(TAGS).analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });

  test("publishing needs the confirmation; then the audience is notified once and a student can read it", async () => {
    await officer.goto(url);
    await officer.getByRole("button", { name: "Publish announcement" }).click();
    await expect(officer.getByText("Tick the box to confirm")).toBeVisible();
    await officer.getByRole("checkbox", { name: /I have checked the preview/ }).check();
    await officer.getByRole("button", { name: "Publish announcement" }).click();
    await officer.waitForURL(/published=\d+/);
    await expect(officer.getByText(/Published\. \d+ student\(s\) were notified\./)).toBeVisible();
    await student.goto("/student/announcements");
    await student.getByRole("link", { name: TITLE }).click();
    await expect(student.getByRole("row", { name: /Batch 2 CC3 and CC4/ })).toBeVisible();
  });

  test("another college's officer gets 404 and a student is sent away from the staff page", async () => {
    expect((await other.goto(url))?.status()).toBe(404);
    await student.goto(url);
    expect(new URL(student.url()).pathname).not.toBe(new URL(url).pathname);
  });

  test("a coordinator can announce to their own department but cannot reach drive creation or officer pages", async () => {
    await coord.goto("/coordinator/announcements/new");
    await coord.getByLabel("Type of announcement").selectOption("GENERAL");
    await coord.getByLabel("Title").fill(`Coordinator note ${Date.now()}`);
    await coord.getByLabel("Summary").fill("Bring your ID card.");
    await coord.getByLabel("Link students should use (optional)").fill("https://example.test/forms/id-card");   // regression: the 0028 link pattern was invalid in Postgres until 0030 repaired it
    await coord.getByRole("button", { name: "Save draft" }).click();
    await expect(coord.getByText(/Choose the department\(s\) this is for/)).toBeVisible();   // no department ticked: refused by the database
    await coord.getByRole("checkbox").first().check();
    await coord.getByRole("button", { name: "Save draft" }).click();
    await coord.waitForURL(/\/coordinator\/announcements\/[0-9a-f-]{36}\?created=1/);
    await coord.goto("/placement/drives/new");
    expect(new URL(coord.url()).pathname).not.toBe("/placement/drives/new");
    await coord.goto("/placement/announcements");
    expect(new URL(coord.url()).pathname).not.toBe("/placement/announcements");
  });

  const PRODESK = `On Campus Drive in our college!\n\nName of the Company: Prodesk IT\nDate: 18/11/2099\nTime: 9.10 AM\nVenue: Placement Auditorium, NEC\n\nRegistered students list attached.\n\nInterview Process:\n- Pre Placement Talk\n- Round 1 Part A: Online Test\n- Final Round: HR Interviews`;
  const HIRING = `Zooye Info Technologies is hiring WordPress Developer Freshers (2027 batch). CTC details: no stipend during internship, Rs 7,000 per month later. Eligibility: CS or IT graduates. Apply here: https://forms.gle/abc123 before 20/11/2099.`;

  test("composer: a pasted on-campus schedule is explained, saved as an announcement draft (not a drive) with the original message kept", async () => {
    const drivesBefore = Number((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM drives"))[0].n);
    await officer.goto("/placement/announcements/compose");
    await officer.getByLabel("Paste the company or placement message").fill(PRODESK);
    await officer.getByRole("button", { name: "Analyze message" }).click();
    const box = officer.getByTestId("classification");
    await expect(box).toContainText("On-campus drive schedule");
    await expect(box).toContainText("announcement draft");
    await expect(box).toContainText("Nothing is published and nobody is notified");
    await officer.getByRole("button", { name: "Create the draft" }).click();
    await officer.waitForURL(/\/placement\/announcements\/[0-9a-f-]{36}\?created=1&composed=1/);
    const id = officer.url().match(/announcements\/([0-9a-f-]{36})/)![1];
    const [row] = await inspect<{ kind: string; status: string; original_message: string }>("SELECT kind, status, original_message FROM announcements WHERE id = $1", [id]);
    expect(row.kind).toBe("ON_CAMPUS_DRIVE"); expect(row.status).toBe("DRAFT"); expect(row.original_message).toBe(PRODESK);
    expect(Number((await inspect<{ n: string }>("SELECT count(*)::text AS n FROM drives"))[0].n)).toBe(drivesBefore);
    // what the reader found is already in the draft, with its evidence beside it
    await expect(officer.locator("#event_date")).toHaveValue("2099-11-18"); await expect(officer.locator("#event_time")).toHaveValue("9.10 AM");
    await expect(officer.locator("#venue")).toHaveValue("Placement Auditorium, NEC");
    await expect(officer.locator("#stages")).toHaveValue(/Pre Placement Talk\nRound 1 Part A: Online Test\nRound 1 Part B: Coding Assessment\nRound 2: Technical Machine Test\nFinal Round: HR Interviews|Pre Placement Talk\nRound 1 Part A: Online Test\nFinal Round: HR Interviews/);
    const panel = officer.getByTestId("extraction-panel");
    await expect(panel.locator('[data-field="event_date"]')).toHaveAttribute("data-status", "EXTRACTED");
    await expect(panel.locator('[data-field="event_date"]')).toContainText("Date: 18/11/2099");
    await expect(panel.getByTestId("extraction-missing")).toContainText("Consent deadline");
    await expect(panel.getByText(/attachment/i)).toBeVisible();                       // the attached student list is noted, never read
    const none = await inspect<{ n: string }>("SELECT count(*)::text AS n FROM announcement_audiences WHERE announcement_id = $1", [id]); expect(none[0].n).toBe("0");   // no audience is chosen for the officer
  });

  test("composer: a training message keeps one venue per batch and reports the missing date", async () => {
    await officer.goto("/placement/announcements/compose");
    await officer.getByLabel("Paste the company or placement message").fill("Final Year Training – Venue Details\n\nHCL Students – Cloud Training\n\nBatch 1: CC1 & CC2\nBatch 2: cc3 & cc4\n\nKindly inform the respective students and ensure they report to their assigned classrooms on time.");
    await officer.getByRole("button", { name: "Analyze message" }).click();
    await expect(officer.getByTestId("classification")).toContainText("Training and venue information");
    await officer.getByRole("button", { name: "Create the draft" }).click();
    await officer.waitForURL(/composed=1/);
    await expect(officer.locator("#batches")).toHaveValue("Batch 1 | CC1 & CC2\nBatch 2 | CC3 & CC4");
    await expect(officer.getByTestId("extraction-panel").locator('[data-field="batches"]')).toHaveAttribute("data-status", "EXTRACTED");
    await expect(officer.getByTestId("extraction-missing")).toContainText("Event date");
    await expect(officer.getByRole("article", { name: "Announcement" }).getByRole("row", { name: /Batch 2 CC3 & CC4/ })).toBeVisible();
  });

  test("composer: a hiring announcement is suggested as a drive draft for an officer; a coordinator cannot save it as a drive", async () => {
    await officer.goto("/placement/announcements/compose");
    await officer.getByLabel("Paste the company or placement message").fill(HIRING);
    await officer.getByRole("button", { name: "Analyze message" }).click();
    await expect(officer.getByTestId("classification")).toContainText("drive draft");
    await expect(officer.getByLabel("Save it as")).toHaveValue("NEW_DRIVE");
    await coord.goto("/coordinator/announcements/compose");
    await coord.getByLabel("Paste the company or placement message").fill(HIRING);
    await coord.getByRole("button", { name: "Analyze message" }).click();
    await expect(coord.getByTestId("classification")).toContainText("Only placement officers can create drives");
    await expect(coord.getByLabel("Save it as").locator("option[value=NEW_DRIVE]")).toHaveCount(0);
  });

  test("composer: the manual override wins and a double submit makes one draft", async () => {
    await officer.goto("/placement/announcements/compose");
    await officer.getByLabel("Paste the company or placement message").fill(PRODESK + "\nExtra line for a distinct message.");
    await officer.getByLabel("What is this message?").selectOption("TRAINING_VENUE");
    await officer.getByRole("button", { name: "Analyze message" }).click();
    await expect(officer.getByLabel("Save it as")).toHaveValue("TRAINING_VENUE");
    await officer.getByRole("button", { name: "Create the draft" }).dblclick();
    await officer.waitForURL(/composed=1/);
    const n = await inspect<{ n: string }>("SELECT count(*)::text AS n FROM announcements WHERE original_message LIKE '%Extra line for a distinct message.%'");
    expect(Number(n[0].n)).toBe(1);
  });

  test("changing a published announcement needs a reason and keeps the history", async () => {
    await officer.goto(url);
    await officer.getByLabel("Summary").fill("Report to your assigned classroom 10 minutes early.");
    await officer.getByRole("button", { name: "Save changes" }).click();
    await expect(officer.getByText(/Say why you are changing/)).toBeVisible();
    await officer.getByLabel("Why are you changing it?").fill("Reporting time added");
    await officer.getByRole("button", { name: "Save changes" }).click();
    await expect(officer.getByText("Saved.")).toBeVisible();
    await officer.reload();
    await expect(officer.getByText(/version 2/i).first()).toBeVisible();
    await expect(officer.getByText("Reason: Reporting time added")).toBeVisible();
  });
});

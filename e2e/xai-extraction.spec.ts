import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { appDb, closeAppDb, inspect } from "../db/tests/world";
import { ANNOUNCEMENT, CONTRADICTORY, FAILING, HOSTILE } from "./ai-fixture";
import { loginAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
void appDb;
const field = (p: Page, key: string) => p.locator(`[data-field="${key}"]`);
const REVIEW = /\/placement\/drives\/ai\/[0-9a-f-]{36}$/;

test.describe.serial("AI-assisted drive creation (stand-in provider; the real provider is never called by tests)", () => {
  let officer: Page; let other: Page; let student: Page;
  let reviewUrl = ""; let driveId = "";
  test.beforeAll(async ({ browser }) => {
    officer = await (await browser.newContext()).newPage(); await loginAs(officer, "roundOfficer");
    other = await (await browser.newContext()).newPage(); await loginAs(other, "officerB");
    student = await (await browser.newContext()).newPage(); await loginAs(student, "regA");
  });
  test.afterAll(async () => { for (const p of [officer, other, student]) await p.context().close(); await closeAppDb(); });
  const chip = async (label: string) => Number((await officer.goto("/placement/drives"), await officer.getByLabel("Status counts").getByRole("link", { name: new RegExp(`^${label} \\(`) }).innerText()).match(/\((\d+)\)/)![1]);
  const paste = async (text: string) => { await officer.goto("/placement/drives/new"); await officer.getByRole("radio", { name: /AI-assisted creation/ }).click(); await officer.getByLabel("Company announcement").fill(text); };

  test("two creation options; manual stays the default and still works; AI option asks for text", async () => {
    await officer.goto("/placement/drives/new");
    await expect(officer.getByRole("radio", { name: /Manual creation/ })).toHaveAttribute("aria-checked", "true");
    await expect(officer.getByRole("button", { name: "Create draft" })).toBeVisible();
    await officer.getByRole("radio", { name: /AI-assisted creation/ }).click();
    await officer.getByRole("button", { name: "Extract details" }).click();
    await expect(officer.getByText("Paste the company’s announcement first.")).toBeVisible();
    await officer.getByRole("button", { name: "create the drive manually" }).click();
    await expect(officer.getByRole("button", { name: "Create draft" })).toBeVisible();
  });

  test("pasting an announcement creates a persistent, editable DRAFT with evidence; a double click makes exactly one", async () => {
    const before = { draft: await chip("Draft"), published: await chip("Published") };
    await paste(ANNOUNCEMENT);
    await officer.getByRole("button", { name: "Extract details" }).dblclick();
    await officer.waitForURL(REVIEW); reviewUrl = officer.url();
    await expect(officer.getByRole("heading", { name: "Review the AI-assisted draft" })).toBeVisible();
    await expect(officer.getByText("Draft — not visible to students")).toBeVisible();
    // values, statuses and evidence
    await expect(officer.locator("#f-company")).toHaveValue("Orbit Analytics");
    await expect(field(officer, "company")).toHaveAttribute("data-status", "EXTRACTED");
    await expect(officer.locator("#f-minCgpa")).toHaveValue("7.5");
    await expect(field(officer, "minCgpa")).toContainText("minimum 7.5 CGPA");
    await expect(officer.locator("#f-maxBacklogs")).toHaveValue("0");
    await expect(officer.locator("#f-ctcLpa")).toHaveValue("9.5");
    await expect(officer.locator("#f-deadline")).toHaveValue("2099-03-04T17:00");
    await expect(officer.locator('input[name="f.departments"][value="REG"]')).toBeChecked();
    await expect(field(officer, "website")).toHaveAttribute("data-status", "MISSING");
    await expect(field(officer, "website")).toContainText("Not provided in the announcement.");
    await expect(officer.getByLabel("Original announcement text")).toContainText("Orbit Analytics is hiring Associate Data Engineers");
    // summary and one draft only
    await expect(officer.locator('[data-summary="extracted"]')).toContainText(/\d+/);
    expect(await chip("Draft")).toBe(before.draft + 1); expect(await chip("Published")).toBe(before.published);
    const rows = await inspect<{ n: string }>("SELECT count(*)::text AS n FROM drive_intakes WHERE source_text = $1", [ANNOUNCEMENT]); expect(Number(rows[0].n)).toBe(1);
    const [{ drive_id }] = await inspect<{ drive_id: string }>("SELECT drive_id FROM drive_intakes WHERE source_text = $1", [ANNOUNCEMENT]); driveId = drive_id;
    expect((await inspect<{ status: string }>("SELECT status FROM drives WHERE id = $1", [driveId]))[0].status).toBe("DRAFT");
  });

  test("the review page has no accessibility violations", async () => {
    await officer.goto(reviewUrl);
    const a11y = await new AxeBuilder({ page: officer }).withTags(TAGS).analyze();
    expect(a11y.violations.map((v) => `${v.id} ${v.nodes.length}`)).toEqual([]);
  });

  test("a student cannot open the draft or the review page; another college's officer gets nothing", async () => {
    await student.goto(reviewUrl); await expect(student.getByRole("heading", { name: "Review the AI-assisted draft" })).toHaveCount(0);
    await student.goto(`/student/drives/${driveId}`); await expect(student.getByText("Orbit Analytics")).toHaveCount(0);
    const res = await other.goto(reviewUrl); expect(res?.status()).toBe(404);
    await expect(other.getByText("Orbit Analytics")).toHaveCount(0);
  });

  test("staff correct a value and add a missing one without leaving the page; the draft drive follows", async () => {
    await officer.goto(reviewUrl);
    await officer.locator("#f-openings").fill("9");
    await officer.locator("#f-website").fill("https://orbit.example");
    await officer.locator("#f-location").fill("Hyderabad, Telangana");
    await officer.getByRole("button", { name: "Save changes to the draft" }).click();
    await expect(officer.getByText("Saved to the draft drive.")).toBeVisible();
    await officer.reload();
    await expect(officer.locator("#f-openings")).toHaveValue("9"); await expect(field(officer, "openings")).toContainText("edited or confirmed by staff");
    await expect(officer.locator("#f-website")).toHaveValue("https://orbit.example");
    const [d] = await inspect<{ openings: number; location: string }>("SELECT openings, location FROM drives WHERE id = $1", [driveId]); expect(d).toMatchObject({ openings: 9, location: "Hyderabad, Telangana" });
    await officer.goto(`/placement/drives/${driveId}`);
    await expect(officer.getByText("AI-assisted draft")).toBeVisible(); await expect(officer.getByRole("button", { name: "Publish drive" })).toHaveCount(0);
  });

  test("re-reading the announcement never overwrites staff values: it shows a comparison and applies only what is ticked", async () => {
    await officer.goto(reviewUrl);
    await officer.getByRole("button", { name: "Read the announcement again" }).click();
    await expect(officer.getByText("Compare the results below")).toBeVisible();
    const panel = officer.getByRole("form", { name: "Compare the new reading" });
    await expect(panel).toBeVisible(); await expect(panel).toContainText("Different from YOUR value");
    await expect(panel.getByRole("row", { name: /Openings/ })).toContainText("9");
    await panel.getByRole("button", { name: "Replace the ticked values" }).click();
    await expect(officer.getByText("No values were replaced.")).toBeVisible();
    await officer.reload(); await expect(officer.locator("#f-openings")).toHaveValue("9");
  });

  test("the same announcement again is flagged as a possible duplicate, with a link to the existing record", async () => {
    await paste(ANNOUNCEMENT); await officer.getByRole("button", { name: "Extract details" }).click();
    await officer.waitForURL(REVIEW);
    await expect(officer.getByText(/Possible duplicate/)).toBeVisible();
    await expect(officer.getByText("This exact announcement was already submitted.")).toBeVisible();
    await expect(officer.getByRole("link", { name: /View Orbit Analytics/ }).first()).toBeVisible();
  });

  test("a contradiction shows both values with their evidence and nothing is chosen for the officer; publishing waits for the choice", async () => {
    await paste(CONTRADICTORY); await officer.getByRole("button", { name: "Extract details" }).click(); await officer.waitForURL(REVIEW);
    const f = field(officer, "minCgpa");
    await expect(f).toHaveAttribute("data-status", "CONTRADICTORY"); await expect(officer.locator("#f-minCgpa")).toHaveValue("");
    await expect(f.getByRole("group", { name: /Conflicting values/ })).toContainText("minimum CGPA 7.0"); await expect(f.getByRole("group", { name: /Conflicting values/ })).toContainText("minimum CGPA of 7.5");
    await expect(officer.locator('[data-summary="contradictions"]')).toContainText("1");
    await expect(officer.getByRole("button", { name: "Publish drive" })).toBeDisabled();
    await f.getByRole("button", { name: "Use 7.5" }).click();
    await officer.getByRole("button", { name: "Save changes to the draft" }).click(); await expect(officer.getByText(/Saved/).first()).toBeVisible();
    await officer.reload(); await expect(officer.locator("#f-minCgpa")).toHaveValue("7.5"); await expect(field(officer, "minCgpa")).toHaveAttribute("data-status", "EXTRACTED");
  });

  test("a misbehaving model reply and a prompt-injection announcement change nothing: invented values ignored, warning shown, nothing published", async () => {
    const before = { published: await chip("Published") };
    await paste(HOSTILE); await officer.getByRole("button", { name: "Extract details" }).click(); await officer.waitForURL(REVIEW);
    await expect(officer.getByText(/looks like instructions to an AI/)).toBeVisible();
    await expect(officer.locator("#f-minCgpa")).toHaveValue(""); await expect(field(officer, "openings")).toContainText("8");     // 8 from the text, never 80
    await expect(officer.locator("#f-openings")).toHaveValue("8");
    await expect(officer.getByText(/suggestion\(s\) from the AI assistant were ignored/)).toBeVisible();
    expect(await chip("Published")).toBe(before.published);
  });

  test("when the AI service fails the announcement is kept, pattern results are shown with a clear notice, and nothing internal leaks", async () => {
    await paste(FAILING); await officer.getByRole("button", { name: "Extract details" }).click(); await officer.waitForURL(REVIEW);
    await expect(officer.getByText(/The AI assistant returned an error\./)).toBeVisible();
    await expect(officer.getByText(/You can try the extraction again/)).toBeVisible();
    await expect(officer.getByLabel("Original announcement text")).toContainText("Brightpath Systems");
    await expect(officer.locator("#f-ctcLpa")).toHaveValue("4");
    await expect(officer.locator("body")).not.toContainText(/stack|ECONN|at async|e2e-stand-in/i);
  });

  test("publishing is the officer's explicit act: validated, previewed, confirmed — then the existing publish, eligibility and notification run", async () => {
    await officer.goto(reviewUrl);
    await expect(officer.getByRole("heading", { name: "Preview and publish" })).toBeVisible();
    await expect(officer.getByLabel("Eligibility criteria")).toContainText("CGPA of at least 7.50");
    const publish = officer.getByRole("button", { name: "Publish drive" });
    await expect(publish).toBeEnabled();                                                                     // every eligibility value was extracted cleanly
    await publish.click();
    await expect(officer.getByText("Tick the box to confirm that you checked the preview.")).toBeVisible();
    expect((await inspect<{ status: string }>("SELECT status FROM drives WHERE id = $1", [driveId]))[0].status).toBe("DRAFT");
    await officer.getByLabel(/I have checked the preview/).check(); await publish.click();
    await officer.waitForURL(new RegExp(`/placement/drives/${driveId}\\?notice=published`));
    expect((await inspect<{ status: string }>("SELECT status FROM drives WHERE id = $1", [driveId]))[0].status).toBe("PUBLISHED");
    const note = await inspect<{ n: string }>("SELECT count(*)::text AS n FROM notifications WHERE link = $1", [`/student/drives/${driveId}`]); expect(Number(note[0].n)).toBeGreaterThan(0);
    await officer.goto(reviewUrl); await expect(officer.getByText(/This drive is published/)).toBeVisible(); await expect(officer.getByRole("button", { name: "Save changes to the draft" })).toHaveCount(0);
    await student.goto(`/student/drives/${driveId}`); await expect(student.getByText("Orbit Analytics").first()).toBeVisible();
  });

  test("each step was audited without the announcement text", async () => {
    const rows = await inspect<{ action: string; metadata: unknown }>("SELECT action, metadata FROM audit_log WHERE entity_type = 'drive_intake' ORDER BY id");
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(["AI_INTAKE_CREATED", "AI_INTAKE_EXTRACTED", "AI_INTAKE_EDITED", "AI_INTAKE_REEXTRACTED"]));
    expect(JSON.stringify(rows)).not.toContain("Orbit Analytics");
  });
});

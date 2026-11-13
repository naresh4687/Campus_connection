import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { appDb, closeAppDb, inspect } from "../db/tests/world";
import { ANNOUNCEMENT, HOSTILE } from "./ai-fixture";
import { loginAs } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
void appDb;

test.describe.serial("AI-assisted draft (stand-in provider; the real provider is never called by tests)", () => {
  let officer: Page;
  test.beforeAll(async ({ browser }) => { officer = await (await browser.newContext()).newPage(); await loginAs(officer, "roundOfficer"); });
  test.afterAll(async () => { await officer.context().close(); await closeAndMaybe(); });
  const closeAndMaybe = () => closeAppDb();
  const chip = async (label: string) => Number((await officer.goto("/placement/drives"), await officer.getByLabel("Status counts").getByRole("link", { name: new RegExp(`^${label} \\(`) }).innerText()).match(/\((\d+)\)/)![1]);

  test("setup: the company named in the announcement exists", async () => {
    await officer.goto("/placement/companies/new");
    await officer.getByLabel("Company name", { exact: true }).fill("Orbit Analytics");
    await officer.getByRole("button", { name: "Add company" }).click();
    await officer.waitForURL(/\/placement\/companies\/[0-9a-f-]{36}\?created=1$/);
  });

  test("a faithful extraction is checked against the text, pre-fills the form, and saves nothing until the officer creates the draft", async () => {
    const before = { draft: await chip("Draft"), published: await chip("Published") };
    await officer.goto("/placement/drives/new");
    await officer.getByRole("button", { name: "Extract details" }).click();
    await expect(officer.getByText("Paste the announcement text first.")).toBeVisible();
    await officer.getByLabel("Company announcement").fill(ANNOUNCEMENT);
    await officer.getByRole("button", { name: "Extract details" }).click();
    const table = officer.getByRole("table", { name: "Details found in the announcement" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("row", { name: /Company/ })).toContainText("Found in the text");
    await expect(table.getByRole("row", { name: /CTC/ })).toContainText("9.5");
    await expect(table.getByRole("row", { name: /Minimum CGPA/ })).toContainText("minimum 7.5 CGPA");
    await expect(officer.getByText("An AI assistant read the announcement.")).toBeVisible();
    // nothing has been saved yet
    expect(await chip("Draft")).toBe(before.draft);
    await officer.goBack();
    await officer.getByLabel("Company announcement").fill(ANNOUNCEMENT);
    await officer.getByRole("button", { name: "Extract details" }).click();
    await expect(table).toBeVisible();
    const a11y = await new AxeBuilder({ page: officer }).withTags(TAGS).analyze();
    expect(a11y.violations.map((v) => `${v.id} ${v.nodes.length}`)).toEqual([]);
    await officer.getByRole("button", { name: "Use these details in the form below" }).click();
    await expect(officer.getByText("The form below has been filled in.")).toBeVisible();
    await expect(officer.getByLabel("Job title")).toHaveValue("Associate Data Engineer");
    await expect(officer.getByLabel("Company", { exact: true })).toHaveValue(/[0-9a-f-]{36}/);
    await expect(officer.getByLabel("Openings")).toHaveValue("8");
    await expect(officer.getByLabel("Minimum CGPA")).toHaveValue("7.5");
    await expect(officer.getByLabel("Minimum 10th %")).toHaveValue("65");
    await expect(officer.getByLabel("Maximum active backlogs")).toHaveValue("0");
    await expect(officer.getByLabel("Application deadline (IST)")).toHaveValue("2099-03-04T17:00");
    await expect(officer.getByLabel("REG")).toBeChecked();
    await expect(officer.getByLabel("2026", { exact: true })).toBeChecked();
    expect(await chip("Draft")).toBe(before.draft);                                      // still nothing saved
    await officer.goBack().catch(() => {});
  });

  test("the officer creates the draft with their own click; it is a DRAFT, never published by the assistant", async () => {
    await officer.goto("/placement/drives/new");
    await officer.getByLabel("Company announcement").fill(ANNOUNCEMENT);
    await officer.getByRole("button", { name: "Extract details" }).click();
    await officer.getByRole("button", { name: "Use these details in the form below" }).click();
    const before = { draft: await chip("Draft"), published: await chip("Published") };
    await officer.goto("/placement/drives/new");
    await officer.getByLabel("Company announcement").fill(ANNOUNCEMENT);
    await officer.getByRole("button", { name: "Extract details" }).click();
    await officer.getByRole("button", { name: "Use these details in the form below" }).click();
    await officer.getByRole("button", { name: "Create draft" }).click();
    await officer.waitForURL(/\/placement\/drives\/[0-9a-f-]{36}\?created=1$/);
    await expect(officer.getByText("Draft created.")).toBeVisible();
    await expect(officer.getByRole("button", { name: "Publish drive" })).toBeVisible();   // still needs the officer's decision
    expect(await chip("Draft")).toBe(before.draft + 1);
    expect(await chip("Published")).toBe(before.published);
  });

  test("a misbehaving reply is neutralised: invented or unsupported values are ignored, extra instructions do nothing, nothing is published", async () => {
    const before = { draft: await chip("Draft"), published: await chip("Published") };
    await officer.goto("/placement/drives/new");
    await officer.getByLabel("Company announcement").fill(HOSTILE);
    await officer.getByRole("button", { name: "Extract details" }).click();
    const table = officer.getByRole("table", { name: "Details found in the announcement" });
    await expect(table).toBeVisible();
    await expect(table.getByRole("row", { name: /Minimum CGPA/ })).toContainText("Not in the text — ignored");
    await expect(table.getByRole("row", { name: /Employment type/ })).toContainText("Not in the text — ignored");
    await expect(table.getByRole("row", { name: /Openings/ })).toContainText("Not in the text — ignored");
    await expect(table.getByRole("row", { name: /^Company/ })).toContainText("Found in the text");
    const checks = officer.getByRole("list", { name: "Things to check" });
    await expect(checks).toContainText("Missing — Departments was not found");
    await expect(checks).toContainText("Uncertain — Not stated clearly");
    await officer.getByRole("button", { name: "Use these details in the form below" }).click();
    await expect(officer.getByLabel("Job title")).toHaveValue("Data Engineer");
    await expect(officer.getByLabel("Minimum CGPA")).toHaveValue("");
    await expect(officer.getByLabel("Openings")).toHaveValue("");
    await expect(officer.getByLabel("Employment type")).toHaveValue("");
    expect(await chip("Draft")).toBe(before.draft); expect(await chip("Published")).toBe(before.published);
  });

  test("each use is audited with counts only — the announcement text is never stored", async () => {
    const rows = await inspect<{ metadata: Record<string, unknown> }>("SELECT metadata FROM audit_log WHERE action = 'AI_EXTRACTION_USED' ORDER BY id");
    expect(rows.length).toBeGreaterThanOrEqual(3);
    for (const r of rows) expect(Object.keys(r.metadata).sort()).toEqual(["accepted", "chars", "ignored"]);
    expect(JSON.stringify(rows)).not.toContain("Orbit");
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { sql } from "kysely";
import { appDb, closeAppDb, driveInput, inspect, makeCompany, makeDrive, type Actor } from "../db/tests/world";
import { withTenantTx } from "../src/server/db";
import { formAlert, loginAs, seed } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const pdf = (label: string) => Buffer.from(`%PDF-1.7\n1 0 obj << /Title (${label} ${Math.random()}) >> endobj\n%%EOF\n`);
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const inDays = (d: number) => new Date(Date.now() + d * 86400_000 + 5.5 * 3600_000).toISOString().slice(0, 16);

async function actor(key: string, role: Actor["role"]): Promise<Actor> {
  const email = seed().users[key];
  const [u] = await inspect<{ id: string; college_id: string }>("SELECT id, college_id FROM users WHERE email = $1", [email]);
  return { userId: u.id, collegeId: u.college_id, role, email };
}
const run = (a: Actor, q: ReturnType<typeof sql>) => withTenantTx(a, (t) => q.execute(t), appDb());

test.describe.serial("selections, offers, joining and verified placements", () => {
  let officer: Page; let offA: Page; let offB: Page; let admin: Page; let otherCollege: Page;
  const open: Page[] = [];
  let driveId = ""; let letterHref = "";
  const newPage = async (b: Browser, who: string) => { const p = await (await b.newContext()).newPage(); open.push(p); await loginAs(p, who); return p; };
  const card = (p: Page, name: string) => p.locator("section").filter({ has: p.getByRole("heading", { name, exact: true }) });
  const funnelValue = (p: Page, label: string) => p.getByLabel("Placement funnel").locator("div", { hasText: new RegExp(`^${label}`) }).locator("dd");

  test.beforeAll(async ({ browser }) => {
    // Earlier phases are covered by their own specs: build the state "drive closed, final round released, two students selected" directly in the database.
    const off = await actor("offerOfficer", "PLACEMENT_OFFICER");
    const [dept] = await inspect<{ id: string }>("SELECT id FROM departments WHERE code = 'REG' AND college_id = $1", [off.collegeId]);
    const company = await makeCompany(off, `Offer Test Co ${Date.now()}`);
    driveId = await makeDrive(off, driveInput(company, [dept.id], { title: "Offer Test Role", minCgpa: 7, deadline: new Date(Date.now() + 5 * 86400_000).toISOString() }), true);
    const regs: string[] = [];
    for (const key of ["offA", "offB"]) {
      const st = await actor(key, "STUDENT");
      regs.push(((await run(st, sql`SELECT registrations.register(${driveId}::uuid) AS id`)).rows[0] as { id: string }).id);
    }
    await run(off, sql`SELECT placement.set_drive_status(${driveId}::uuid, 'CLOSED')`);
    const round = ((await run(off, sql`SELECT rounds.save_round(null, ${driveId}::uuid, 'Final', 'HR', null, null, null) AS id`)).rows[0] as { id: string }).id;
    await run(off, sql`SELECT rounds.set_results(${round}::uuid, ${sql.raw(`ARRAY[${regs.map((r) => `'${r}'`).join(",")}]::uuid[]`)}, 'SELECTED', null)`);
    await run(off, sql`SELECT rounds.release_round(${round}::uuid)`);
    officer = await newPage(browser, "offerOfficer"); offA = await newPage(browser, "offA"); offB = await newPage(browser, "offB");
    admin = await newPage(browser, "regAdmin"); otherCollege = await newPage(browser, "officerB");
  });
  test.afterAll(async () => { for (const p of open) await p.context().close(); await closeAppDb(); });

  test("the officer records the final selection; no offer exists yet and students see 'not issued'", async () => {
    await officer.goto(`/placement/drives/${driveId}/offers`);
    await expect(officer.getByLabel("Students who can be selected").getByRole("listitem")).toHaveCount(2);
    await officer.getByRole("button", { name: "Record selection for ticked students" }).click();
    await expect(formAlert(officer)).toContainText("Tick at least one student");
    await officer.getByLabel(/Test offA/).check(); await officer.getByLabel(/Test offB/).check();
    await officer.getByRole("button", { name: "Record selection for ticked students" }).click();
    await expect(officer.getByText("Selection recorded. No offer has been issued yet.")).toBeVisible();
    await expect(card(officer, "Test offA")).toContainText("Selected — offer not issued yet");
    await offA.goto("/student/offers");
    await expect(offA.getByRole("row", { name: /Offer Test Role/ })).toContainText("offer not issued yet");
    await offA.getByRole("link", { name: "Offer Test Role" }).click();
    await expect(offA.getByText("The placement office has not issued the offer yet.")).toBeVisible();
    await expect(offA.getByRole("button", { name: /Accept|Decline/ })).toHaveCount(0);
  });

  test("an offer letter is uploaded and the offer issued; bad input is refused with kept values", async () => {
    await officer.goto(`/placement/drives/${driveId}/offers`);
    const c = card(officer, "Test offA");
    await c.getByLabel("Offer letter (optional)").setInputFiles({ name: "offer-letter.pdf", mimeType: "application/pdf", buffer: pdf("letter") });
    await c.getByRole("button", { name: "Upload letter" }).click();
    await expect(officer.getByText("Offer letter uploaded.")).toBeVisible();
    letterHref = (await card(officer, "Test offA").getByRole("link", { name: "Open offer letter" }).getAttribute("href"))!;
    expect(letterHref).toMatch(/^\/offer-files\/[0-9a-f-]{36}\/download$/);
    const c2 = card(officer, "Test offA");
    await c2.getByLabel("CTC offered (LPA)").fill("abc");
    await c2.getByLabel("Response deadline (IST)").fill(inDays(5));
    await c2.getByRole("button", { name: "Issue offer" }).click();
    await expect(formAlert(officer)).toContainText("Enter the CTC in LPA");
    await expect(card(officer, "Test offA").getByLabel("CTC offered (LPA)")).toHaveValue("abc");
    await card(officer, "Test offA").getByLabel("CTC offered (LPA)").fill("7.25");
    await card(officer, "Test offA").getByLabel("Response deadline (IST)").fill("2020-01-01T10:00");
    await card(officer, "Test offA").getByRole("button", { name: "Issue offer" }).click();
    await expect(formAlert(officer)).toContainText("deadline must be in the future");
    await card(officer, "Test offA").getByLabel("Response deadline (IST)").fill(inDays(5));
    await card(officer, "Test offA").getByRole("button", { name: "Issue offer" }).click();
    await expect(officer.getByText("Offer issued.")).toBeVisible();
    await expect(card(officer, "Test offA")).toContainText("Offer issued — awaiting response");
    await expect(card(officer, "Test offA")).toContainText("7.25 LPA");
    await card(officer, "Test offB").getByLabel("Response deadline (IST)").fill(inDays(5));
    await card(officer, "Test offB").getByRole("button", { name: "Issue offer" }).click();
    await expect(officer.getByText("Offer issued.")).toBeVisible();
  });

  test("students open their own letter, answer once, and nobody else can open it", async () => {
    await offA.goto("/student/offers");
    await offA.getByRole("link", { name: "Offer Test Role" }).click();
    await expect(offA.getByText("7.25 LPA")).toBeVisible();
    const res = await offA.request.get(letterHref, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()["cache-control"]).toContain("no-store");
    expect(res.headers().location).toMatch(/X-Amz-Signature=/);
    expect((await offB.request.get(letterHref, { maxRedirects: 0 })).status()).toBe(404);          // another student's letter
    expect((await otherCollege.request.get(letterHref, { maxRedirects: 0 })).status()).toBe(404);   // another college
    expect((await (await offA.context().browser()!.newContext()).request.get(letterHref, { maxRedirects: 0, failOnStatusCode: false })).status()).toBe(303);   // anonymous -> login
    await offA.getByRole("button", { name: "Accept this offer" }).click();
    await expect(offA.getByText("You accepted this offer.")).toBeVisible();
    await expect(offA.getByRole("button", { name: /Accept|Decline/ })).toHaveCount(0);              // final
    await offB.goto("/student/offers"); await offB.getByRole("link", { name: "Offer Test Role" }).click();
    await offB.getByRole("button", { name: "Decline this offer" }).click();
    await expect(offB.getByText("You declined this offer.")).toBeVisible();
    await expect(offB.getByText("Joining and placement")).toHaveCount(0);                           // a declined offer cannot lead to a placement
  });

  test("an accepted offer is not a placement: the funnel keeps the numbers apart", async () => {
    await officer.goto("/placement/placements");
    await expect(funnelValue(officer, "Selected")).toHaveText(/^\d+$/);
    const before = { accepted: Number(await funnelValue(officer, "Offers accepted").innerText()), verified: Number(await funnelValue(officer, "Verified placements").innerText()) };
    expect(before.accepted).toBeGreaterThanOrEqual(1);
    expect(before.verified).toBe(0);
    await expect(officer.getByText("Nothing here.").first()).toBeVisible();
  });

  test("the student records joining with proof; the officer rejects with a reason; the student corrects; the officer verifies", async () => {
    await offA.goto("/student/offers"); await offA.getByRole("link", { name: "Offer Test Role" }).click();
    await expect(offA.getByText("Upload your joining proof above first.")).toBeVisible();
    await expect(offA.getByRole("button", { name: "Record joining" })).toBeDisabled();
    await offA.getByLabel(/Joining proof/).setInputFiles({ name: "joining-1.pdf", mimeType: "application/pdf", buffer: pdf("proof1") });
    await offA.getByRole("button", { name: "Upload proof" }).click();
    await expect(offA.getByText("Joining proof uploaded.")).toBeVisible();
    await offA.getByLabel("Date you joined").fill("2999-01-01");
    await offA.getByRole("button", { name: "Record joining" }).click();
    await expect(formAlert(offA)).toContainText("cannot be in the future");
    await offA.getByLabel("Date you joined").fill(today());
    await offA.getByLabel("Designation (optional)").fill("Associate Engineer");
    await offA.getByRole("button", { name: "Record joining" }).click();
    await expect(offA.getByText("Joining recorded.")).toBeVisible();
    await expect(offA.getByText("Joining awaiting verification")).toBeVisible();

    await officer.goto("/placement/placements");
    const item = officer.getByRole("list", { name: "Joining records" }).first();
    await expect(item).toContainText("Test offA");
    await expect(item.getByRole("link", { name: "Open joining proof" })).toBeVisible();
    await expect(funnelValue(officer, "Joining recorded")).toHaveText("1");
    await expect(funnelValue(officer, "Verified placements")).toHaveText("0");                       // recorded is not verified
    await item.getByRole("button", { name: "Do not verify" }).click();
    await expect(formAlert(officer)).toContainText("at least 5 characters");
    await item.getByLabel("Reason for not verifying").fill("The proof is unreadable");
    await item.getByRole("button", { name: "Do not verify" }).click();
    await expect(officer.getByText("Joining record not verified.")).toBeVisible();

    await offA.goto("/student/offers"); await offA.getByRole("link", { name: "Offer Test Role" }).click();
    await expect(offA.getByText("Not verified: The proof is unreadable")).toBeVisible();
    await offA.getByLabel(/Joining proof/).setInputFiles({ name: "joining-2.pdf", mimeType: "application/pdf", buffer: pdf("proof2") });
    await offA.getByRole("button", { name: "Upload proof" }).click();
    await expect(offA.getByText("Joining proof uploaded.")).toBeVisible();
    await offA.getByLabel("Date you joined").fill(today());
    await offA.getByRole("button", { name: "Record joining" }).click();
    await expect(offA.getByText("Joining recorded.")).toBeVisible();

    await officer.goto("/placement/placements");
    await officer.getByRole("list", { name: "Joining records" }).first().getByRole("button", { name: "Verify placement" }).click();
    await expect(officer.getByText("Placement verified.")).toBeVisible();
    await expect(funnelValue(officer, "Verified placements")).toHaveText("1");
    await offA.reload();
    await expect(offA.getByText("Verified placement")).toBeVisible();
  });

  test("an offer with a verified placement cannot be withdrawn; the administrator can override, with a reason, and the number drops", async () => {
    await officer.goto(`/placement/drives/${driveId}/offers`);
    const c = card(officer, "Test offA");
    await c.getByLabel("Reason for withdrawing").fill("Company asked to cancel");
    await c.getByRole("button", { name: "Withdraw offer" }).click();
    await expect(formAlert(officer)).toContainText("verified placement exists");
    await admin.goto("/college/placements");
    await expect(funnelValue(admin, "Verified placements")).toHaveText("1");
    const item = admin.getByRole("list", { name: "Joining records" }).first();
    await item.getByRole("button", { name: "Override: mark as not verified" }).click();
    await expect(formAlert(admin)).toContainText("at least 10 characters");
    await item.getByLabel(/Reason for the override/).fill("Joining letter was forged");
    await item.getByRole("button", { name: "Override: mark as not verified" }).click();
    await expect(admin.getByText("Override recorded.")).toBeVisible();
    await expect(funnelValue(admin, "Verified placements")).toHaveText("0");
    await expect(admin.getByRole("list", { name: "Joining records" }).first()).toContainText("Overridden by administrator");
    await officer.goto("/placement/placements");
    await expect(funnelValue(officer, "Verified placements")).toHaveText("0");
    // the officer cannot override
    const r = await officer.goto("/college/placements");
    expect(r?.status() === 404 || !/\/college\/placements$/.test(officer.url()) || (await officer.getByRole("heading", { name: "Placements" }).count()) === 0).toBe(true);
    // now the offer can be withdrawn
    await officer.goto(`/placement/drives/${driveId}/offers`);
    await card(officer, "Test offA").getByLabel("Reason for withdrawing").fill("Company asked to cancel");
    await card(officer, "Test offA").getByRole("button", { name: "Withdraw offer" }).click();
    await expect(officer.getByText("Offer withdrawn.")).toBeVisible();
    await expect(card(officer, "Test offA")).toContainText("Offer withdrawn");
    await offA.goto("/student/offers");
    await expect(offA.getByRole("row", { name: /Offer Test Role/ })).toContainText("Offer withdrawn");
  });

  test("the offer pages pass the automated accessibility scan", async () => {
    for (const [p, url] of [[officer, `/placement/drives/${driveId}/offers`], [officer, "/placement/placements"], [offB, "/student/offers"], [admin, "/college/placements"]] as [Page, string][]) {
      await p.goto(url);
      const a11y = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
      expect(a11y.violations.map((v) => `${url}: ${v.id} ${v.nodes.length}`)).toEqual([]);
    }
  });
});

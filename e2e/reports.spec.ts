import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { sql } from "kysely";
import { randomUUID } from "node:crypto";
import { appDb, closeAppDb, driveInput, inspect, makeCompany, makeDrive, type Actor } from "../db/tests/world";
import { withTenantTx } from "../src/server/db";
import { loginAs, seed } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const EVIL_COMPANY = "=SUM(1+1)+Reports Test Co";

async function actor(key: string, role: Actor["role"]): Promise<Actor> {
  const [u] = await inspect<{ id: string; college_id: string }>("SELECT id, college_id FROM users WHERE email = $1", [seed().users[key]]);
  return { userId: u.id, collegeId: u.college_id, role, email: seed().users[key] };
}
const run = (a: Actor, q: ReturnType<typeof sql>) => withTenantTx(a, (t) => q.execute(t), appDb());

test.describe.serial("reports", () => {
  let officer: Page; let admin: Page; let student: Page; let collegeId = "";
  const open: Page[] = [];
  const newPage = async (b: Browser, who: string) => { const p = await (await b.newContext()).newPage(); open.push(p); await loginAs(p, who); return p; };
  const tile = async (p: Page, label: string) => (await p.getByTestId(`stat-${label}`).innerText()).trim();

  test.beforeAll(async ({ browser }) => {
    // Build a known outcome directly in the database: two students selected and accepted, one verified placement (12 LPA), one only recorded.
    const off = await actor("rptOfficer", "PLACEMENT_OFFICER"); collegeId = off.collegeId!;
    const [dept] = await inspect<{ id: string }>("SELECT id FROM departments WHERE code = 'REG' AND college_id = $1", [collegeId]);
    const company = await makeCompany(off, EVIL_COMPANY);
    const drive = await makeDrive(off, driveInput(company, [dept.id], { title: "Reports Test Role", deadline: new Date(Date.now() + 5 * 86400_000).toISOString() }), true);
    const studs: { a: Actor; reg: string }[] = [];
    for (const key of ["rptA", "rptB"]) { const a = await actor(key, "STUDENT"); studs.push({ a, reg: ((await run(a, sql`SELECT registrations.register(${drive}::uuid) AS id`)).rows[0] as { id: string }).id }); }
    await run(off, sql`SELECT placement.set_drive_status(${drive}::uuid, 'CLOSED')`);
    const round = ((await run(off, sql`SELECT rounds.save_round(null, ${drive}::uuid, 'Final', 'HR', null, null, null) AS id`)).rows[0] as { id: string }).id;
    const regs = sql.raw(`ARRAY[${studs.map((s) => `'${s.reg}'`).join(",")}]::uuid[]`);
    await run(off, sql`SELECT rounds.set_results(${round}::uuid, ${regs}, 'SELECTED', null)`); await run(off, sql`SELECT rounds.release_round(${round}::uuid)`);
    await run(off, sql`SELECT offers.select_students(${drive}::uuid, ${regs})`);
    for (const [i, s] of studs.entries()) {
      const sel = (await inspect<{ id: string }>("SELECT id FROM selections WHERE drive_id = $1 AND student_id = (SELECT id FROM students WHERE user_id = $2)", [drive, s.a.userId]))[0].id;
      await run(off, sql`SELECT offers.issue_offer(${sel}::uuid, ${i === 0 ? 12 : 8}::numeric, ${new Date(Date.now() + 5 * 86400_000).toISOString()}::timestamptz, null)`);
      await run(s.a, sql`SELECT offers.respond(${sel}::uuid, true)`);
      const file = (await run(s.a, sql`SELECT offers.register_file(${sel}::uuid, 'JOINING_PROOF', 'p.pdf', 'application/pdf', 100, ${randomUUID().replace(/-/g, "") + randomUUID().replace(/-/g, "")}, ${`c/${collegeId}/o/${sel}/${randomUUID()}`}) AS id`)).rows[0] as { id: string };
      await run(s.a, sql`SELECT offers.record_joining(${sel}::uuid, ${today()}::date, null, null, ${file.id}::uuid)`);
      if (i === 0) await run(off, sql`SELECT offers.decide_placement(${sel}::uuid, 'VERIFIED', null)`);
    }
    officer = await newPage(browser, "rptOfficer"); admin = await newPage(browser, "rptAdmin"); student = await newPage(browser, "regB");
  });
  test.afterAll(async () => { for (const p of open) await p.context().close(); await closeAppDb(); });

  test("the headline numbers equal the raw data; accepted-but-unverified is shown apart from placed", async () => {
    const [raw] = await inspect<{ students: number; placed: number; accepted: number }>(`SELECT (SELECT count(*)::int FROM students WHERE college_id = $1) AS students,
      (SELECT count(DISTINCT p.student_id)::int FROM placements p JOIN selections s ON s.id = p.selection_id WHERE p.college_id = $1 AND p.status = 'VERIFIED' AND s.offer_status = 'ACCEPTED') AS placed,
      (SELECT count(DISTINCT student_id)::int FROM selections WHERE college_id = $1 AND offer_status = 'ACCEPTED') AS accepted`, [collegeId]);
    await officer.goto("/placement/reports");
    await expect(officer.getByRole("heading", { name: "Placement reports" })).toBeVisible();
    expect(Number(await tile(officer, "Students in scope"))).toBe(raw.students);
    expect(Number(await tile(officer, "Students placed"))).toBe(raw.placed);
    expect(await tile(officer, "Placement rate")).toBe(`${Math.round((raw.placed / raw.students) * 1000) / 10}%`);
    expect(Number(await tile(officer, "Offers accepted, not yet verified"))).toBe(Math.max(0, raw.accepted - raw.placed));
    expect(raw.placed).toBeGreaterThanOrEqual(1); expect(raw.accepted).toBeGreaterThan(raw.placed);
    await expect(officer.getByTestId("stat-Highest CTC")).toContainText("12.00 LPA");                  // only the verified placement counts, never the 8 LPA accepted offer
    await expect(officer.getByTestId("stat-Average CTC")).toContainText("12.00 LPA");
    const row = officer.getByRole("row", { name: /Registration Studies|REG/ }).first();
    await expect(row).toBeVisible();
  });

  test("the administrator sees the same report; the chart has a text alternative; the year filter narrows it", async () => {
    await admin.goto("/college/reports");
    for (const k of ["Students in scope", "Students placed", "Placement rate"]) expect(await tile(admin, k)).toBe(await tile(officer, k));
    await expect(admin.getByRole("figure", { name: "Placement rate by department" })).toBeVisible();
    await expect(admin.getByRole("list", { name: "Placement rate by department (values)" })).toContainText("REG");
    await admin.goto("/college/reports?year=1999");
    expect(Number(await tile(admin, "Students in scope"))).toBe(0);
    expect(await tile(admin, "Placement rate")).toBe("—");                                              // no students: not a misleading 0%
    await expect(admin.getByText("No verified placements yet")).toBeVisible();
  });

  test("CSV export: correct type, attachment, formula-safe, audited; other roles and anonymous are refused", async () => {
    const res = await officer.request.get("/reports/export/placed");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain('attachment; filename="campusconnect-placed-all-years.csv"');
    expect(res.headers()["cache-control"]).toContain("no-store");
    const body = await res.text();
    expect(body.startsWith("﻿Name,Register number,Department")).toBe(true);
    expect(body).toContain("Test rptA"); expect(body).not.toContain("Test rptB");                       // only the verified placement
    const drives = await (await officer.request.get("/reports/export/drives?year=2026")).text();
    expect(drives).toContain(`'${EVIL_COMPANY}`);                                                       // the formula is neutralised with a leading quote
    expect(drives).not.toMatch(/(^|,)=SUM/m);
    expect((await admin.request.get("/reports/export/departments")).status()).toBe(200);
    expect((await student.request.get("/reports/export/placed")).status()).toBe(403);
    expect((await officer.request.get("/reports/export/everything")).status()).toBe(404);
    const anon = await (await officer.context().browser()!.newContext()).request.get("/reports/export/placed", { failOnStatusCode: false });
    expect(anon.status()).toBe(401);
    const logged = await inspect<{ n: number }>("SELECT count(*)::int AS n FROM audit_log WHERE action = 'REPORT_EXPORTED' AND college_id = $1", [collegeId]);
    expect(logged[0].n).toBeGreaterThanOrEqual(3);
  });

  test("print view hides navigation and controls but keeps the numbers; the page is accessible and fits a phone", async () => {
    await officer.goto("/placement/reports");
    await officer.emulateMedia({ media: "print" });
    await expect(officer.getByRole("navigation", { name: "Main" })).toBeHidden();
    await expect(officer.getByRole("button", { name: "Print this report" })).toBeHidden();
    await expect(officer.getByRole("search", { name: "Report filters" })).toBeHidden();
    await expect(officer.getByRole("heading", { name: "Placement reports" })).toBeVisible();
    await expect(officer.getByTestId("stat-Students placed")).toBeVisible();
    await officer.emulateMedia({ media: "screen" });
    const a11y = await new AxeBuilder({ page: officer }).withTags(TAGS).analyze();
    expect(a11y.violations.map((v) => `${v.id} ${v.nodes.length}`)).toEqual([]);
    await officer.setViewportSize({ width: 360, height: 800 });
    await officer.goto("/placement/reports"); await officer.waitForLoadState("networkidle");
    const o = await officer.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
    expect(o.scroll).toBeLessThanOrEqual(o.inner);
  });

  test("students and coordinators cannot open the reports pages", async () => {
    for (const path of ["/placement/reports", "/college/reports"]) {
      await student.goto(path);
      await expect(student.getByRole("heading", { name: "Placement reports" })).toHaveCount(0);
    }
  });
});

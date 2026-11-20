import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { sql } from "kysely";
import { appDb, closeAppDb, inspect, makeDepartment, type Actor } from "../db/tests/world";
import { withTenantTx } from "../src/server/db";
import { formAlert, loginAs, seed } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const run = (a: Actor, q: ReturnType<typeof sql>) => withTenantTx(a, (t) => q.execute(t), appDb());
const uniqueRef = Date.now().toString().slice(-6);

test.describe.serial("college sign-up link, approval, separate sign-in pages", () => {
  let admin: Page; let coord: Page;
  let adminActor: Actor; let regDept = ""; let genDept = ""; let hiddenName = ""; let shownName = "";
  let link = "";
  const open: Page[] = [];
  const newPage = async (b: Browser, who?: string) => { const p = await (await b.newContext()).newPage(); open.push(p); if (who) await loginAs(p, who); return p; };
  const fill = async (p: Page, o: Record<string, string>) => {
    await p.getByLabel("Full name").fill(o.name); await p.getByLabel("Register number").fill(o.reg);
    await p.getByLabel("Department").selectOption(o.dept);
    await p.getByLabel("College email").fill(o.email); await p.getByLabel("Mobile number").fill(o.phone ?? "+91 98765 43210");
    await p.getByLabel("Degree").selectOption("B.E."); await p.getByLabel("Year you joined").selectOption(String(new Date().getFullYear() - 3)); await p.getByLabel("Year you finish").selectOption(String(new Date().getFullYear() + 1));
    await p.getByLabel("Choose a password", { exact: true }).fill(o.pw ?? "Join-Pass-12345"); await p.getByLabel("Confirm password").fill(o.pw ?? "Join-Pass-12345");
  };

  test.beforeAll(async ({ browser }) => {
    const [u] = await inspect<{ id: string; college_id: string }>("SELECT id, college_id FROM users WHERE email = $1", [seed().users.rptAdmin]);
    adminActor = { userId: u.id, collegeId: u.college_id, role: "COLLEGE_ADMIN", email: seed().users.rptAdmin };
    [regDept] = (await inspect<{ id: string }>("SELECT id FROM departments WHERE code = 'REG' AND college_id = $1", [u.college_id])).map((r) => r.id);
    [genDept] = (await inspect<{ id: string }>("SELECT id FROM departments WHERE code = 'GEN' AND college_id = $1", [u.college_id])).map((r) => r.id);
    // one department that exists and is active, one that exists but was deactivated
    const shown = await makeDepartment(adminActor); const hidden = await makeDepartment(adminActor);
    await run(adminActor, sql`SELECT college.set_department_status(${hidden}::uuid, 'INACTIVE')`);
    shownName = (await inspect<{ name: string }>("SELECT name::text AS name FROM departments WHERE id = $1", [shown]))[0].name;
    hiddenName = (await inspect<{ name: string }>("SELECT name::text AS name FROM departments WHERE id = $1", [hidden]))[0].name;
    admin = await newPage(browser, "rptAdmin"); coord = await newPage(browser, "regCoord");
  });
  test.afterAll(async () => { for (const p of open) await p.context().close(); await closeAppDb(); });

  test("students and staff have their own sign-in pages, with the form on the page and the notices kept", async ({ browser }) => {
    const p = await newPage(browser);
    await p.goto("/login/student");
    await expect(p.getByRole("heading", { name: "Student sign in" })).toBeVisible();
    await expect(p.getByLabel("Email")).toBeVisible();                                      // no extra step before the form
    await expect(p.getByRole("link", { name: "Staff sign in" })).toHaveAttribute("href", "/login/college");
    const a11y = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
    expect(a11y.violations.map((v) => v.id)).toEqual([]);
    await p.goto("/login/college");
    await expect(p.getByRole("heading", { name: "College staff sign in" })).toBeVisible();
    await p.goto("/login/student?welcome=1");
    await expect(p).toHaveURL(/\/login\/student\?welcome=1$/);
    await expect(p.getByText("Your account is ready.")).toBeVisible();
  });

  test("the administrator gets one shareable link, with copy and WhatsApp buttons, and can see the switch state", async () => {
    await admin.goto("/college/students");
    await expect(admin.getByRole("heading", { name: "Let students sign themselves up" })).toBeVisible();
    if (await admin.getByRole("button", { name: "Turn link on" }).count()) { await admin.getByRole("button", { name: "Turn link on" }).click(); await expect(admin.getByText("The sign-up link is on.")).toBeVisible(); await admin.reload(); }
    link = await admin.getByLabel("Sign-up link").inputValue();
    expect(link).toMatch(/\/join\/[0-9a-f-]{36}\.\d+\.[A-Za-z0-9_-]{32}$/);
    await expect(admin.getByRole("button", { name: "Copy link" })).toBeVisible();
    const wa = await admin.getByRole("link", { name: "Share on WhatsApp" }).getAttribute("href");
    expect(wa).toContain("https://wa.me/?text="); expect(decodeURIComponent(wa!)).toContain(link);
  });

  test("the public page shows the college and ONLY the departments it created and has active; mistakes are explained", async ({ browser }) => {
    const p = await newPage(browser);
    await p.goto(link);
    await expect(p.getByRole("heading", { name: "Student sign-up" })).toBeVisible();
    await expect(p.getByText("Northfield Institute of Technology")).toBeVisible();
    const options = await p.getByLabel("Department").locator("option").allInnerTexts();
    expect(options.some((o) => o.includes(shownName))).toBe(true);
    expect(options.some((o) => o.includes(hiddenName))).toBe(false);                     // deactivated department: not offered
    await expect(p.getByLabel("College email")).toBeVisible(); await expect(p.getByLabel("Mobile number")).toBeVisible();
    await p.getByRole("button", { name: "Request my account" }).click();
    for (const f of ["fullName", "registerNumber", "departmentId", "collegeEmail", "phone", "degree", "admissionYear", "passingYear", "password"]) await expect(p.locator(`#${f}-error`), f).toBeVisible();
    const a11y = await new AxeBuilder({ page: p }).withTags(TAGS).analyze();
    expect(a11y.violations.map((v) => v.id)).toEqual([]);
  });

  test("a student asks for an account; nothing works until approval (sign-in is refused); a second request for another department is not visible to the first department's coordinator", async ({ browser }) => {
    const p = await newPage(browser);
    await p.goto(link);
    await fill(p, { name: "Join Student One", reg: `JS1${uniqueRef}`, dept: regDept, email: `join.one.${uniqueRef}@e2e.test`, pw: "short" });
    await p.getByRole("button", { name: "Request my account" }).click();
    await expect(p.locator("#password-error")).toBeVisible();
    await expect(p.getByLabel("Full name")).toHaveValue("Join Student One");              // kept
    await p.getByLabel("Choose a password", { exact: true }).fill("Join-Pass-12345"); await p.getByLabel("Confirm password").fill("Join-Pass-12345");
    await p.getByRole("button", { name: "Request my account" }).click();
    await expect(p.getByRole("heading", { name: "Request sent" })).toBeVisible();
    await expect(p.getByText("You can sign in after it is approved")).toBeVisible();

    const q = await newPage(browser);                                                      // department GEN: not the coordinator's
    await q.goto(link);
    await fill(q, { name: "Join Student Two", reg: `JS2${uniqueRef}`, dept: genDept, email: `join.two.${uniqueRef}@e2e.test` });
    await q.getByRole("button", { name: "Request my account" }).click();
    await expect(q.getByRole("heading", { name: "Request sent" })).toBeVisible();

    const dup = await newPage(browser); await dup.goto(link);                              // the same register number again
    await fill(dup, { name: "Impostor", reg: `JS1${uniqueRef}`, dept: regDept, email: `other.${uniqueRef}@e2e.test` });
    await dup.getByRole("button", { name: "Request my account" }).click();
    await expect(formAlert(dup)).toContainText("already has an account or is waiting for approval");

    const s = await newPage(browser); await s.goto("/login/student");
    await s.getByLabel("Email").fill(`join.one.${uniqueRef}@e2e.test`); await s.getByLabel("Password").fill("Join-Pass-12345");
    await s.getByRole("button", { name: "Sign in" }).click();
    await expect(formAlert(s)).toContainText("Invalid email or password");
  });

  test("the department's coordinator sees only their department's request and approves it; the student then signs in to a working account", async ({ browser }) => {
    await coord.goto("/coordinator/requests");
    const list = coord.getByRole("list", { name: "Sign-up requests" });
    await expect(list).toContainText("Join Student One"); await expect(list).toContainText("+91 98765 43210");
    await expect(list).not.toContainText("Join Student Two");                              // another department
    await list.getByRole("listitem").filter({ hasText: "Join Student One" }).getByRole("button", { name: "Approve" }).click();
    await expect(coord.getByText("Approved. The student can sign in now.")).toBeVisible();
    const s = await newPage(browser); await s.goto("/login/student");
    await s.getByLabel("Email").fill(`join.one.${uniqueRef}@e2e.test`); await s.getByLabel("Password").fill("Join-Pass-12345");
    await s.getByRole("button", { name: "Sign in" }).click();
    await s.waitForURL((u) => u.pathname === "/student");
    await s.goto("/student/profile");
    await expect(s.getByText(`JS1${uniqueRef}`)).toBeVisible(); await expect(s.getByLabel(/Mobile|Phone/i)).toHaveValue("+91 98765 43210");
  });

  test("the administrator sees every request, rejects one with a reason, and the person cannot sign in", async ({ browser }) => {
    await admin.goto("/college/students/requests");
    const item = admin.getByRole("list", { name: "Sign-up requests" }).getByRole("listitem").filter({ hasText: "Join Student Two" });
    await item.getByRole("button", { name: "Reject" }).click();
    await expect(formAlert(admin)).toContainText("at least 5 characters");
    await item.getByLabel(/Reason/).fill("Not a student of this department");
    await item.getByRole("button", { name: "Reject" }).click();
    await expect(admin.getByText("Rejected.")).toBeVisible();
    await expect(admin.getByRole("listitem").filter({ hasText: "Join Student Two" })).toContainText("Not a student of this department");
    const s = await newPage(browser); await s.goto("/login/student");
    await s.getByLabel("Email").fill(`join.two.${uniqueRef}@e2e.test`); await s.getByLabel("Password").fill("Join-Pass-12345");
    await s.getByRole("button", { name: "Sign in" }).click();
    await expect(formAlert(s)).toContainText("Invalid email or password");
  });

  test("turning the link off or making a new one stops the old link at once", async ({ browser }) => {
    await admin.goto("/college/students");
    await admin.getByRole("button", { name: "Turn link off" }).click();
    await expect(admin.getByText("The sign-up link is off.")).toBeVisible();
    const p = await newPage(browser); await p.goto(link);
    await expect(p.getByText("not valid, has been turned off, or has been replaced")).toBeVisible();
    await admin.reload(); await admin.getByRole("button", { name: "Turn link on" }).click(); await expect(admin.getByText("The sign-up link is on.")).toBeVisible();
    await p.goto(link); await expect(p.getByRole("heading", { name: "Student sign-up" })).toBeVisible();
    await admin.reload(); await admin.getByRole("button", { name: "Make a new link" }).click(); await expect(admin.getByText("A new link was created.")).toBeVisible();
    await p.goto(link); await expect(p.getByText("not valid, has been turned off, or has been replaced")).toBeVisible();
    await admin.reload(); const fresh = await admin.getByLabel("Sign-up link").inputValue();
    expect(fresh).not.toBe(link);
    await p.goto(fresh); await expect(p.getByRole("heading", { name: "Student sign-up" })).toBeVisible();
    const forged = link.replace(/\.[A-Za-z0-9_-]{32}$/, "." + "A".repeat(32));
    await p.goto(forged); await expect(p.getByText("not valid, has been turned off, or has been replaced")).toBeVisible();
  });

  test("regression: accepting an invitation while another account is signed in does NOT land on that account's console", async ({ browser }) => {
    await admin.goto("/college/staff");
    await admin.getByLabel("Email", { exact: true }).fill(`invited.${uniqueRef}@e2e.test`);
    await admin.getByLabel("Role", { exact: true }).last().selectOption("COORDINATOR");
    await admin.getByLabel("Department", { exact: true }).selectOption({ index: 1 });
    await admin.getByRole("button", { name: "Create invitation" }).click();
    const invite = await admin.getByTestId("invite-link-panel").getByLabel("One-time link").inputValue();
    const p = await newPage(browser, "ntfA");                                              // this browser is signed in as a student
    await p.goto(invite);
    await expect(p.getByText(/currently signed in as/)).toHaveCount(0);                    // a staff invitation does not touch the student's sign-in
    await p.getByLabel("Full name").fill("Invited Coordinator");
    await p.getByLabel("Choose a password", { exact: true }).fill("Invite-Pass-12345"); await p.getByLabel("Confirm password").fill("Invite-Pass-12345");
    await p.getByRole("button", { name: "Create account" }).click();
    await p.waitForURL(/\/login\/college\?welcome=1$/);                                    // the coordinator's own sign-in page, not the student's home
    await expect(p.getByText("Your account is ready.")).toBeVisible();
    await p.getByLabel("Email").fill(`invited.${uniqueRef}@e2e.test`); await p.getByLabel("Password").fill("Invite-Pass-12345");
    await p.getByRole("button", { name: "Sign in" }).click();
    await p.waitForURL((u) => u.pathname === "/coordinator");
    await p.goto("/student"); await expect(p).toHaveURL(/\/student$/);                     // the student is still signed in alongside
  });
});

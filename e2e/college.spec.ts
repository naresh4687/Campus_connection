import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectOn, formAlert, loginAs } from "./helpers";

const settle = async (page: Page) => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); };
const stat = async (page: Page, label: string) => Number(await page.getByTestId(`stat-${label}`).innerText());
const coordPassword = "Coord-Passw0rd!-Nine";
const SCAN_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe.serial("college administrator console", () => {
  let admin: Page;
  let coord: Page;
  const open: Page[] = [];
  let coordInvite = "";
  let cseUrl = "";

  const newContextPage = async (browser: Browser) => { const p = await (await browser.newContext()).newPage(); open.push(p); return p; };
  const addDept = async (name: string, code: string) => {
    await admin.goto("/college/departments");
    await admin.getByLabel("Department name").fill(name);
    await admin.getByLabel("Code").fill(code);
    await admin.getByRole("button", { name: "Add department" }).click();
    await settle(admin);
  };

  test.beforeAll(async ({ browser }) => { admin = await newContextPage(browser); await loginAs(admin, "adminA"); });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("dashboard shows the college and live counts; navigation lists only real sections", async () => {
    await admin.goto("/college");
    await expect(admin.getByRole("heading", { name: "College dashboard" })).toBeVisible();
    await expect(admin.getByText("Northfield Institute of Technology").first()).toBeVisible();
    for (const n of ["Dashboard", "Departments", "Staff", "College profile", "Audit log", "Account"]) await expect(admin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: n })).toBeVisible();
    expect(await stat(admin, "Active departments")).toBe(2); // seeded: GEN (the seeded students need a department) and REG (registration scenarios)
    expect(await stat(admin, "Placement officers")).toBe(5); // seeded: officerA, officerX, roundOfficer, offerOfficer, rptOfficer
    expect(await stat(admin, "Coordinators")).toBe(2);       // seeded: coordA, regCoord
    expect(await stat(admin, "Students")).toBeGreaterThanOrEqual(6);
  });

  test("departments: validation, creation, duplicates", async () => {
    await admin.goto("/college/departments");
    await expect(admin.getByRole("row", { name: /GEN/ })).toBeVisible();
    await admin.getByRole("button", { name: "Add department" }).click();
    await settle(admin);
    await expect(admin.locator("#name-error")).toBeVisible();
    await admin.getByLabel("Department name").fill("Computer Science and Engineering");
    await admin.getByLabel("Code").fill("bad code!");
    await admin.getByRole("button", { name: "Add department" }).click();
    await settle(admin);
    await expect(admin.locator("#code-error")).toBeVisible();
    await expect(admin.getByLabel("Department name")).toHaveValue("Computer Science and Engineering"); // kept

    await addDept("Computer Science and Engineering", "cse");
    await expect(admin.getByText("Department CSE created.")).toBeVisible();
    await expect(admin.getByLabel("Department name")).toHaveValue(""); // form cleared after success
    await addDept("Electronics and Communication", "ECE");
    await addDept("Mechanical Engineering", "MECH");

    await addDept("Another Name", "CSE"); // duplicate code
    await expect(formAlert(admin)).toContainText("already exists");
    await addDept("computer science and engineering", "CSX"); // duplicate name, different case
    await expect(formAlert(admin)).toContainText("already exists");

    await admin.goto("/college/departments");
    const rows = admin.getByRole("row");
    await expect(rows).toHaveCount(6); // header + GEN + REG + 3
    await expect(admin.getByRole("row", { name: /CSE/ })).toContainText("Active");
    await admin.getByRole("link", { name: "Computer Science and Engineering" }).click();
    await admin.waitForURL(/\/college\/departments\/[0-9a-f-]{36}$/);
    cseUrl = admin.url();
  });

  test("a department can be edited, deactivated and reactivated", async () => {
    await admin.goto(cseUrl);
    await admin.getByLabel("Description (optional)").fill("Core computing programmes");
    await admin.getByRole("button", { name: "Save changes" }).click();
    await expect(admin.getByText("Department saved.")).toBeVisible();
    await admin.reload();
    await expect(admin.getByLabel("Description (optional)")).toHaveValue("Core computing programmes");

    await admin.getByRole("button", { name: "Deactivate department" }).click();
    await expect(admin.getByText("Department deactivated.")).toBeVisible();
    await expect(admin.getByText("Reactivate this department to assign coordinators.")).toBeVisible();
    await admin.getByRole("button", { name: "Reactivate department" }).click();
    await expect(admin.getByText("Department reactivated.")).toBeVisible();
    await expect(admin.getByLabel("Assign a coordinator")).toBeVisible();
  });

  test("dashboard counts follow the data", async () => {
    await admin.goto("/college");
    expect(await stat(admin, "Active departments")).toBe(5);
    expect(await stat(admin, "Departments without a coordinator")).toBe(4);
    expect(await stat(admin, "Coordinators without a department")).toBe(1);
    await expect(admin.getByText("Create your first department.")).toHaveCount(0);
  });

  test("invite a coordinator and an officer; revoke one; the revoked link is dead", async () => {
    await admin.goto("/college/staff");
    await admin.getByLabel("Email", { exact: true }).fill("new.coordinator@e2e.test");
    await admin.getByLabel("Role", { exact: true }).last().selectOption("COORDINATOR");
    await admin.getByLabel("Department", { exact: true }).selectOption({ label: "CSE · Computer Science and Engineering" }); // a coordinator invitation names its department
    await admin.getByRole("button", { name: "Create invitation" }).click();
    const panel = admin.getByTestId("invite-link-panel");
    await expect(panel).toBeVisible();
    coordInvite = await panel.getByLabel("One-time link").inputValue();
    expect(coordInvite).toMatch(/\/accept-invite\?token=[A-Za-z0-9_-]{43}$/);

    await settle(admin);
    await admin.getByLabel("Email", { exact: true }).fill("new.officer@e2e.test");
    await admin.getByLabel("Role", { exact: true }).last().selectOption("PLACEMENT_OFFICER");
    await admin.getByRole("button", { name: "Create invitation" }).click();
    await expect(admin.getByTestId("invite-link-panel").getByLabel("One-time link")).not.toHaveValue(coordInvite);
    const officerInvite = await admin.getByTestId("invite-link-panel").getByLabel("One-time link").inputValue();

    await admin.goto("/college/staff");
    const pending = admin.getByRole("listitem").filter({ hasText: "new.officer@e2e.test" });
    await expect(pending).toContainText("Placement officer");
    await expect(admin.getByRole("listitem").filter({ hasText: "new.coordinator@e2e.test" })).toContainText("Coordinator");
    await pending.getByRole("button", { name: "Revoke" }).click();
    await expect(admin.getByRole("listitem").filter({ hasText: "new.officer@e2e.test" })).toHaveCount(0); // the row disappears
    await expect(admin.getByRole("listitem").filter({ hasText: "new.coordinator@e2e.test" })).toHaveCount(1);
    const p = await admin.context().browser()!.newContext();
    await p.newPage().then(async (pg) => { await pg.goto(officerInvite); await expect(pg.getByText("invalid, already used, or has expired")).toBeVisible(); });
    await p.close();
  });

  test("the invited coordinator joins and is already assigned to the department chosen in the invitation", async ({ browser }) => {
    coord = await newContextPage(browser);
    await coord.goto(coordInvite);
    await expect(coord.getByText("Northfield Institute of Technology")).toBeVisible();
    await coord.getByLabel("Full name").fill("Casey Coordinator");
    await coord.getByLabel("Choose a password").fill(coordPassword);
    await coord.getByLabel("Confirm password").fill(coordPassword);
    await coord.getByRole("button", { name: "Create account" }).click();
    await expectOn(coord, "/login\\?welcome=1");
    await coord.getByLabel("Email").fill("new.coordinator@e2e.test");
    await coord.getByLabel("Password").fill(coordPassword);
    await coord.getByRole("button", { name: "Sign in" }).click();
    await expectOn(coord, "/coordinator");
    await expect(coord.getByText("You are not assigned to any department yet")).toHaveCount(0);
    const mine = coord.getByRole("list", { name: "Your departments" });
    await expect(mine.getByRole("listitem")).toHaveCount(1);
    await expect(mine).toContainText("CSE");
  });

  test("assigning more departments makes exactly those visible to the coordinator — and no others", async () => {
    await admin.goto("/college/staff?q=Casey");
    await admin.getByRole("link", { name: "Casey Coordinator" }).click();
    await expect(admin.getByText("Not assigned to any department")).toHaveCount(0); // CSE came with the invitation
    for (const label of [/ECE —/]) {
      await admin.getByLabel("Assign to a department").selectOption({ label: await admin.locator("#departmentId option", { hasText: label }).first().innerText() });
      await admin.getByRole("button", { name: "Assign" }).click();
      await expect(admin.getByText("Coordinator assigned.")).toBeVisible();
      await settle(admin);
    }
    await coord.goto("/coordinator");
    const list = coord.getByRole("list", { name: "Your departments" });
    await expect(list.getByRole("listitem")).toHaveCount(2);
    await expect(list).toContainText("CSE");
    await expect(list).toContainText("ECE");
    await expect(list).not.toContainText("MECH");

    await admin.goto("/college/staff?role=COORDINATOR");
    await expect(admin.getByRole("row", { name: /Casey Coordinator/ })).toContainText("CSE, ECE");
  });

  test("removing an assignment takes effect immediately for the coordinator", async () => {
    await admin.goto(cseUrl.replace(/\/departments\/.*/, "/departments"));
    await admin.getByRole("link", { name: "Electronics and Communication" }).click();
    const item = admin.getByRole("listitem").filter({ hasText: "Casey Coordinator" });
    await item.getByRole("button", { name: "Remove" }).click();
    await expect(admin.getByRole("listitem").filter({ hasText: "Casey Coordinator" })).toHaveCount(0);
    await expect(admin.getByText("No coordinator is assigned to this department.")).toBeVisible();
    await coord.goto("/coordinator");
    await expect(coord.getByRole("list", { name: "Your departments" }).getByRole("listitem")).toHaveCount(1);
    await expect(coord.getByRole("list", { name: "Your departments" })).not.toContainText("ECE");
  });

  test("a coordinator can be assigned from the department page, and cannot open the admin console", async () => {
    await admin.goto("/college/departments");
    await admin.getByRole("link", { name: "Mechanical Engineering" }).click();
    await admin.getByLabel("Assign a coordinator").selectOption({ label: "Casey Coordinator (new.coordinator@e2e.test)" });
    await admin.getByRole("button", { name: "Assign" }).click();
    await expect(admin.getByText("Coordinator assigned.")).toBeVisible();
    await coord.goto("/coordinator");
    await expect(coord.getByRole("list", { name: "Your departments" }).getByRole("listitem")).toHaveCount(2);

    for (const path of ["/college", "/college/departments", "/college/staff", "/college/settings", "/college/audit", cseUrl]) {
      await coord.goto(path);
      await expectOn(coord, "/coordinator");
    }
  });

  test("an inactive department stays visible to its coordinator, marked inactive", async () => {
    await admin.goto("/college/departments");
    await admin.getByRole("link", { name: "Mechanical Engineering" }).click();
    await admin.getByRole("button", { name: "Deactivate department" }).click();
    await expect(admin.getByText("Department deactivated.")).toBeVisible();
    await coord.goto("/coordinator");
    await expect(coord.getByRole("listitem").filter({ hasText: "MECH" })).toContainText("Inactive");
    await admin.getByRole("button", { name: "Reactivate department" }).click();
    await expect(admin.getByText("Department reactivated.")).toBeVisible();
  });

  test("disabling a staff account signs them out at once and blocks sign-in; enabling restores it", async () => {
    await admin.goto("/college/staff?q=Casey");
    await admin.getByRole("link", { name: "Casey Coordinator" }).click();
    await admin.getByRole("button", { name: "Disable account" }).click();
    await expect(admin.getByText("Account disabled.")).toBeVisible();
    await coord.goto("/coordinator");
    await expectOn(coord, "/login");
    await coord.getByLabel("Email").fill("new.coordinator@e2e.test");
    await coord.getByLabel("Password").fill(coordPassword);
    await coord.getByRole("button", { name: "Sign in" }).click();
    await expect(formAlert(coord)).toHaveText("Invalid email or password.");
    await expect(admin.getByRole("button", { name: "Create password reset link" })).toHaveCount(0); // nothing to reset while disabled

    await admin.getByRole("button", { name: "Enable account" }).click();
    await expect(admin.getByText("Account enabled.")).toBeVisible();
    await coord.getByLabel("Email").fill("new.coordinator@e2e.test");
    await coord.getByLabel("Password").fill(coordPassword);
    await coord.getByRole("button", { name: "Sign in" }).click();
    await expectOn(coord, "/coordinator");
  });

  test("a one-time password reset link can be issued, is shown once, and works once", async ({ browser }) => {
    await admin.goto("/college/staff?q=Casey");
    await admin.getByRole("link", { name: "Casey Coordinator" }).click();
    await admin.getByRole("button", { name: "Create password reset link" }).click();
    const panel = admin.getByTestId("invite-link-panel");
    await expect(panel).toBeVisible();
    const link = await panel.getByLabel("One-time link").inputValue();
    expect(link).toMatch(/\/reset-password\?token=/);
    await admin.reload();
    await expect(admin.getByTestId("invite-link-panel")).toHaveCount(0);

    const p = await newContextPage(browser);
    await p.goto(link);
    await expect(p.getByText("new.coordinator@e2e.test")).toBeVisible();
    await p.getByLabel("New password", { exact: true }).fill("Reset-By-Admin-Passw0rd!");
    await p.getByLabel("Confirm new password").fill("Reset-By-Admin-Passw0rd!");
    await p.getByRole("button", { name: "Set new password" }).click();
    await expectOn(p, "/login\\?reset=1");
    await coord.goto("/coordinator");
    await expectOn(coord, "/login"); // the coordinator's earlier session was revoked by the reset
    await p.goto(link);
    await expect(p.getByText("invalid, already used, or has expired")).toBeVisible();
  });

  test("an administrator cannot be disabled or reset from the staff screens", async () => {
    await admin.goto("/college/staff?role=COLLEGE_ADMIN");
    await admin.getByRole("link").filter({ hasText: /Test adminA/ }).click();
    await expect(admin.getByText("This is your own account.")).toBeVisible();
    await expect(admin.getByRole("button", { name: "Disable account" })).toHaveCount(0);
  });

  test("staff list supports search and filters", async () => {
    await admin.goto("/college/staff");
    await admin.getByLabel("Search").fill("officer");
    await admin.getByRole("button", { name: "Apply filters" }).click();
    await expect(admin.getByRole("row", { name: /officerA/ })).toBeVisible();
    await expect(admin.getByRole("row", { name: /Casey/ })).toHaveCount(0);
    await admin.goto("/college/staff?role=COORDINATOR&status=ACTIVE");
    await expect(admin.getByRole("row", { name: /Casey/ })).toBeVisible();
    await expect(admin.getByRole("row", { name: /officerA/ })).toHaveCount(0);
    await admin.goto("/college/staff?q=100%25_%5C");
    await expect(admin.getByText("No staff found")).toBeVisible();
  });

  test("college profile: identity is read-only, contact details can be edited and are validated", async () => {
    await admin.goto("/college/settings");
    await expect(admin.getByText("Northfield Institute of Technology")).toBeVisible();
    await expect(admin.getByLabel("College name")).toHaveCount(0); // not editable
    await admin.getByLabel("District").fill("Salem");
    await admin.getByLabel("Website").fill("javascript:alert(1)");
    await admin.getByRole("button", { name: "Save profile" }).click();
    await settle(admin);
    await expect(admin.locator("#website-error")).toBeVisible();
    await expect(admin.getByLabel("District")).toHaveValue("Salem"); // kept
    await admin.getByLabel("Website").fill("https://northfield.example.test");
    await admin.getByLabel("Approximate student strength").fill("2750");
    await admin.getByRole("button", { name: "Save profile" }).click();
    await expect(admin.getByText("College profile saved.")).toBeVisible();
    await admin.reload();
    await expect(admin.getByLabel("District")).toHaveValue("Salem");
    await expect(admin.getByLabel("Approximate student strength")).toHaveValue("2750");
  });

  test("the audit log shows the actions above (and can be filtered)", async () => {
    await admin.goto("/college/audit");
    // the filter lists every action recorded for this college (the table itself is paginated, newest first)
    for (const a of ["Department created", "Department updated", "Department deactivated", "Department reactivated", "Coordinator assigned", "Coordinator unassigned", "User disabled", "User enabled", "Password reset issued", "Invitation created", "Invitation revoked", "College profile updated", "Invitation accepted"]) {
      await expect(admin.locator("#action option", { hasText: new RegExp(`^${a}$`) }), a).toHaveCount(1);
    }
    await admin.getByLabel("Action").selectOption("DEPARTMENT_CREATED");
    await admin.getByRole("button", { name: "Filter" }).click();
    await expect(admin.getByRole("row", { name: /Department created/ })).toHaveCount(5); // GEN + REG (seeded) + CSE, ECE, MECH
    await expect(admin.getByRole("row", { name: /Coordinator assigned/ })).toHaveCount(0);
    await admin.goto("/college");
    await expect(admin.getByText("Recent activity")).toBeVisible();
  });

  test("another college's administrator sees none of this college's data, and its URLs are 404", async ({ browser }) => {
    const deptId = cseUrl.split("/").pop()!;
    const casey = (await admin.goto("/college/staff?q=Casey") && await admin.getByRole("link", { name: "Casey Coordinator" }).getAttribute("href"))!;
    const b = await newContextPage(browser);
    await loginAs(b, "adminB");
    await expectOn(b, "/college");
    await expect(b.getByText("Riverside College of Engineering").first()).toBeVisible();
    expect(await stat(b, "Active departments")).toBe(0);
    await b.goto("/college/departments");
    await expect(b.getByText("No departments yet")).toBeVisible();
    await expect(b.getByText("Computer Science")).toHaveCount(0);
    expect((await b.goto(`/college/departments/${deptId}`))?.status()).toBe(404);
    expect((await b.goto(casey))?.status()).toBe(404);
    await b.goto("/college/staff");
    await expect(b.getByText("Casey Coordinator")).toHaveCount(0);
    await expect(b.getByText("officerA")).toHaveCount(0);
    await b.goto("/college/audit");
    await expect(b.getByText(/Department created/)).toHaveCount(0);
    await b.goto("/college/settings");
    await expect(b.getByLabel("District")).not.toHaveValue("Salem");
  });

  test("officers and students cannot open college administration", async ({ browser }) => {
    for (const key of ["officerX", "studentX"]) {
      const p = await newContextPage(browser);
      await loginAs(p, key);
      const home = p.url();
      for (const path of ["/college", "/college/departments", "/college/staff", "/college/settings", "/college/audit", cseUrl]) {
        await p.goto(path);
        await expect(p).toHaveURL(home);
      }
    }
  });

  test("populated pages pass the automated accessibility scan and fit a phone screen", async () => {
    for (const path of ["/college", "/college/departments", cseUrl.replace(/^https?:\/\/[^/]+/, ""), "/college/staff", "/college/settings", "/college/audit"]) {
      await admin.goto(path);
      await admin.waitForLoadState("networkidle");
      const results = await new AxeBuilder({ page: admin }).withTags(SCAN_TAGS).analyze();
      expect(results.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), path).toEqual([]);
    }
    await admin.setViewportSize({ width: 360, height: 800 });
    for (const path of ["/college", "/college/departments", "/college/staff", "/college/settings", "/college/audit"]) {
      await admin.goto(path);
      await admin.waitForLoadState("networkidle");
      const o = await admin.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(o.scroll, `${path} scrollWidth`).toBeLessThanOrEqual(o.inner);
    }
    await admin.setViewportSize({ width: 1280, height: 720 });
    const coordPage = coord;
    await coordPage.goto("/login"); // coordinator context is signed out now; just prove the page scans cleanly
    const r = await new AxeBuilder({ page: coordPage }).withTags(SCAN_TAGS).analyze();
    expect(r.violations).toEqual([]);
  });
});

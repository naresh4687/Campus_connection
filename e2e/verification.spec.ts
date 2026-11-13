import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectOn, formAlert, loginAs } from "./helpers";

const settle = async (page: Page) => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); };
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const pw = "Verify-Passw0rd!-Sec1";

async function fillAcademics(p: Page, v: Partial<Record<"cgpa" | "tenth" | "twelfth" | "diploma" | "backlogs" | "arrears" | "note", string>>) {
  const map: [string, string | undefined][] = [["Overall CGPA (out of 10)", v.cgpa], ["10th percentage", v.tenth], ["12th percentage", v.twelfth], ["Diploma percentage", v.diploma], ["Active backlogs", v.backlogs], ["Historical arrears", v.arrears], ["Note for the reviewer (optional)", v.note]];
  for (const [label, value] of map) if (value !== undefined) await p.getByLabel(label, { exact: true }).fill(value);
}

test.describe.serial("academic records and verification", () => {
  let admin: Page; let stuA: Page; let stuB: Page; let coord: Page; let secStu: Page; let secCoord: Page;
  const open: Page[] = [];
  let aSubmissionUrl = "";
  let secSubmissionUrl = "";
  const newPage = async (browser: Browser) => { const p = await (await browser.newContext()).newPage(); open.push(p); return p; };
  const tid = (p: Page, id: string) => p.getByTestId(id);

  test.beforeAll(async ({ browser }) => {
    admin = await newPage(browser); await loginAs(admin, "adminA");
    stuA = await newPage(browser); await loginAs(stuA, "acadA");
    stuB = await newPage(browser); await loginAs(stuB, "acadB");
    coord = await newPage(browser); await loginAs(coord, "coordA");
  });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("setup: coordA is assigned to GEN; a second department, student and coordinator are created for scoping tests", async ({ browser }) => {
    await admin.goto("/college/staff?q=coordA");
    await admin.getByRole("link", { name: "Test coordA" }).click();
    await admin.getByLabel("Assign to a department").selectOption({ label: "GEN — General Studies" });
    await admin.getByRole("button", { name: "Assign" }).click();
    await expect(admin.getByText("Coordinator assigned.")).toBeVisible();

    await admin.goto("/college/departments");
    await admin.getByLabel("Department name").fill("Security Studies");
    await admin.getByLabel("Code").fill("SEC");
    await admin.getByRole("button", { name: "Add department" }).click();
    await expect(admin.getByText("Department SEC created.")).toBeVisible();

    await admin.goto("/college/students/new");
    await admin.getByLabel("Register number").fill("SEC0001");
    await admin.getByLabel("Full name").fill("Sec Student");
    await admin.getByLabel("College email").fill("sec.student@e2e.test");
    await admin.getByLabel("Department").selectOption({ label: "SEC — Security Studies" });
    await admin.getByLabel("Degree / course").selectOption("B.Tech");
    await admin.getByLabel("Admission year").fill("2022");
    await admin.getByLabel("Passing year").fill("2026");
    await admin.getByRole("button", { name: "Add student" }).click();
    await admin.waitForURL(/\/college\/students\/[0-9a-f-]{36}\?created=1$/);
    await admin.getByRole("button", { name: "Create invitation" }).click();
    const sLink = await admin.getByTestId("invite-link-panel").getByLabel("One-time link").inputValue();
    secStu = await newPage(browser);
    await secStu.goto(sLink);
    await secStu.getByLabel("Full name").fill("Sec Student");
    await secStu.getByLabel("Choose a password").fill(pw); await secStu.getByLabel("Confirm password").fill(pw);
    await secStu.getByRole("button", { name: "Create account" }).click();
    await expectOn(secStu, "/login\\?welcome=1");
    await secStu.getByLabel("Email").fill("sec.student@e2e.test"); await secStu.getByLabel("Password").fill(pw);
    await secStu.getByRole("button", { name: "Sign in" }).click();
    await expectOn(secStu, "/student");

    await admin.goto("/college/staff");
    await admin.getByLabel("Email", { exact: true }).fill("sec.coord@e2e.test");
    await admin.getByLabel("Role", { exact: true }).last().selectOption("COORDINATOR");
    await admin.getByLabel("Department", { exact: true }).selectOption({ label: "SEC · Security Studies" });
    await admin.getByRole("button", { name: "Create invitation" }).click();
    const cLink = await admin.getByTestId("invite-link-panel").getByLabel("One-time link").inputValue();
    secCoord = await newPage(browser);
    await secCoord.goto(cLink);
    await secCoord.getByLabel("Full name").fill("Sec Coordinator");
    await secCoord.getByLabel("Choose a password").fill(pw); await secCoord.getByLabel("Confirm password").fill(pw);
    await secCoord.getByRole("button", { name: "Create account" }).click();
    await expectOn(secCoord, "/login\\?welcome=1");
    await secCoord.getByLabel("Email").fill("sec.coord@e2e.test"); await secCoord.getByLabel("Password").fill(pw);
    await secCoord.getByRole("button", { name: "Sign in" }).click();
    await expectOn(secCoord, "/coordinator");
  });

  test("a student starts with nothing submitted; the form validates every field and keeps what was typed", async () => {
    await stuA.goto("/student");
    await expect(stuA.getByText("Not submitted").first()).toBeVisible();
    await stuA.getByRole("link", { name: "Open Academics" }).click();
    await expectOn(stuA, "/student/academics");
    await expect(stuA.getByRole("heading", { name: "Submit your academic details" })).toBeVisible();
    await expect(stuA.getByText("Passing year", { exact: false }).first()).toBeVisible();

    await stuA.getByRole("button", { name: "Submit for review" }).click();
    await settle(stuA);
    for (const f of ["cgpa", "tenth", "backlogs", "arrears"]) await expect(stuA.locator(`#${f}-error`)).toBeVisible();

    await fillAcademics(stuA, { cgpa: "8.255", tenth: "90.5", twelfth: "", diploma: "", backlogs: "", arrears: "1", note: "typed note" });
    await stuA.getByRole("button", { name: "Submit for review" }).click();
    await settle(stuA);
    await expect(stuA.locator("#cgpa-error")).toContainText("two decimal");
    await expect(stuA.locator("#twelfth-error")).toContainText("12th percentage or your diploma");
    await expect(stuA.locator("#backlogs-error")).toBeVisible();                     // blank is NOT treated as zero
    await expect(stuA.getByLabel("10th percentage", { exact: true })).toHaveValue("90.5"); // kept
    await expect(stuA.getByLabel("Note for the reviewer (optional)")).toHaveValue("typed note");

    await fillAcademics(stuA, { cgpa: "11", twelfth: "88", backlogs: "0" });
    await stuA.getByRole("button", { name: "Submit for review" }).click();
    await settle(stuA);
    await expect(stuA.locator("#cgpa-error")).toContainText("between 0 and 10");
  });

  test("submitting sends it for review; it cannot be edited while pending, but can be withdrawn", async () => {
    await fillAcademics(stuA, { cgpa: "8.25", tenth: "90.5", twelfth: "88", diploma: "", backlogs: "0", arrears: "1" });
    await stuA.getByRole("button", { name: "Submit for review" }).click();
    await expect(stuA.getByText("Submitted for review.")).toBeVisible();
    await stuA.reload();
    await expect(stuA.getByRole("heading", { name: "Awaiting review" })).toBeVisible();
    await expect(tid(stuA, "v-cgpa").first()).toHaveText("8.25");
    await expect(tid(stuA, "v-diploma").first()).toHaveText("Not provided");           // missing is not zero
    await expect(stuA.getByLabel("Overall CGPA (out of 10)")).toHaveCount(0);           // form hidden while pending

    await stuA.getByRole("button", { name: "Withdraw this submission" }).click();
    await expect(stuA.getByRole("heading", { name: "Submit your academic details" })).toBeVisible();
    await expect(stuA.getByTestId("history-v1")).toContainText("Withdrawn");
    await expect(stuA.getByLabel("Overall CGPA (out of 10)")).toHaveValue("8.25");     // prefilled so nothing has to be retyped
    await stuA.getByRole("button", { name: "Submit for review" }).click();
    await expect(stuA.getByText("Submitted for review.")).toBeVisible();
  });

  test("a second student uses the diploma route; a student in another department also submits", async () => {
    await stuB.goto("/student/academics");
    await fillAcademics(stuB, { cgpa: "7.5", tenth: "81.25", twelfth: "", diploma: "77.5", backlogs: "2", arrears: "3" });
    await stuB.getByRole("button", { name: "Submit for review" }).click();
    await expect(stuB.getByText("Submitted for review.")).toBeVisible();
    await secStu.goto("/student/academics");
    await fillAcademics(secStu, { cgpa: "9", tenth: "95", twelfth: "93", backlogs: "0", arrears: "0" });
    await secStu.getByRole("button", { name: "Submit for review" }).click();
    await expect(secStu.getByText("Submitted for review.")).toBeVisible();
  });

  test("the coordinator's queue shows only their department's pending submissions", async () => {
    await coord.goto("/coordinator");
    await expect(coord.getByTestId("pending-link")).toContainText("2 submissions awaiting your review");
    await coord.getByTestId("pending-link").click();
    await expectOn(coord, "/coordinator/verification");
    await expect(coord.getByRole("row", { name: /Test acadA/ })).toBeVisible();
    await expect(coord.getByRole("row", { name: /Test acadB/ })).toBeVisible();
    await expect(coord.getByText("Sec Student")).toHaveCount(0);                         // other department's student
    await coord.getByLabel("Search").fill("acadB");
    await coord.getByRole("button", { name: "Apply filters" }).click();
    await expect(coord.getByRole("row")).toHaveCount(2);

    await secCoord.goto("/coordinator/verification");
    await expect(secCoord.getByRole("row", { name: /Sec Student/ })).toBeVisible();
    await expect(secCoord.getByText("Test acadA")).toHaveCount(0);
    await secCoord.getByRole("link", { name: "Sec Student" }).click();
    await secCoord.waitForURL(/verification\/[0-9a-f-]{36}$/);
    secSubmissionUrl = secCoord.url();
  });

  test("review: values are shown exactly; rejection needs a reason; the student sees it", async () => {
    await coord.goto("/coordinator/verification?q=acadA");
    await coord.getByRole("link", { name: "Test acadA" }).click();
    await coord.waitForURL(/verification\/[0-9a-f-]{36}$/);
    aSubmissionUrl = coord.url();
    await expect(tid(coord, "v-cgpa")).toHaveText("8.25");
    await expect(tid(coord, "v-tenth")).toHaveText("90.50%");
    await expect(tid(coord, "v-twelfth")).toHaveText("88.00%");
    await expect(tid(coord, "v-diploma")).toHaveText("Not provided");
    await expect(tid(coord, "v-backlogs")).toHaveText("0");
    await expect(tid(coord, "v-arrears")).toHaveText("1");
    await expect(coord.getByText("set by the college")).toBeVisible();
    await expect(coord.getByLabel("Overall CGPA (out of 10)")).toHaveCount(0);           // reviewers cannot edit values

    await coord.getByLabel("Reason (shown to the student)").fill("      ");
    await coord.getByRole("button", { name: "Reject with this reason" }).click();
    await expect(formAlert(coord)).toContainText("at least 5 characters");
    await coord.getByLabel("Reason (shown to the student)").fill("The CGPA does not match the latest semester results.");
    await coord.getByRole("button", { name: "Reject with this reason" }).click();
    await expect(coord.getByText("Rejected. The student can see your reason")).toBeVisible();
    await expect(coord.getByRole("button", { name: "Verify these values" })).toHaveCount(0);

    await stuA.goto("/student/academics");
    await expect(stuA.getByText("Your last submission was rejected.")).toBeVisible();
    await expect(stuA.getByText("The CGPA does not match the latest semester results.").first()).toBeVisible();
    await expect(stuA.getByTestId("history-v2")).toContainText("Rejected");
    await expect(stuA.getByTestId("history-v2")).toContainText("Test coordA");
    await stuA.goto("/student");
    await expect(stuA.getByText("Needs correction").first()).toBeVisible();

    await coord.goto("/coordinator/verification/history");
    await expect(coord.getByRole("row", { name: /Test acadA/ })).toContainText("Rejected");
    await coord.getByLabel("Outcome").selectOption("VERIFIED");
    await coord.getByRole("button", { name: "Apply filters" }).click();
    await expect(coord.getByText("No decisions yet")).toBeVisible();
  });

  test("the student corrects and resubmits; the coordinator verifies; the verified record is shown", async () => {
    await stuA.goto("/student/academics");
    await expect(stuA.getByLabel("Overall CGPA (out of 10)")).toHaveValue("8.25");
    await stuA.getByLabel("Overall CGPA (out of 10)").fill("7.90");
    await stuA.getByRole("button", { name: "Submit for review" }).click();
    await expect(stuA.getByText("Submitted for review.")).toBeVisible();

    await coord.goto("/coordinator/verification?q=acadA");
    await coord.getByRole("link", { name: "Test acadA" }).click();
    await expect(tid(coord, "v-cgpa")).toHaveText("7.90");
    await expect(coord.getByText("Submitted values — version 3")).toBeVisible();
    await coord.getByLabel("Note (optional)").fill("Checked against the mark sheets");
    await coord.getByRole("button", { name: "Verify these values" }).click();
    await expect(coord.getByText("Verified. The student's academic record is now verified.")).toBeVisible();

    await stuA.goto("/student/academics");
    await expect(stuA.getByRole("heading", { name: "Verified record" })).toBeVisible();
    await expect(tid(stuA, "v-cgpa").first()).toHaveText("7.90");
    await expect(stuA.getByText("This is the record used for eligibility.")).toBeVisible();
    await expect(stuA.getByRole("heading", { name: "Update your record" })).toBeVisible();
    await stuA.goto("/student");
    await expect(stuA.getByText("Your academic record is verified.")).toBeVisible();
  });

  test("changing verified data needs a new review: the verified record stays in force meanwhile", async () => {
    await stuA.goto("/student/academics");
    await stuA.getByRole("button", { name: "Submit update for review" }).click();     // identical values -> refused
    await expect(formAlert(stuA)).toContainText("identical to your verified record");
    await settle(stuA);
    await stuA.getByLabel("Active backlogs").fill("1");
    await stuA.getByRole("button", { name: "Submit update for review" }).click();
    await expect(stuA.getByText("Submitted for review.")).toBeVisible();
    await stuA.reload();
    await expect(stuA.getByText("Update awaiting review").first()).toBeVisible();
    await expect(stuA.getByRole("heading", { name: "Verified record" })).toBeVisible();   // still the verified one
    await expect(stuA.getByRole("heading", { name: "Awaiting review" })).toBeVisible();

    await coord.goto("/coordinator/verification?q=acadA");
    await expect(coord.getByRole("row", { name: /Test acadA/ })).toContainText("Update to verified record");
    await coord.getByRole("link", { name: "Test acadA" }).click();
    await expect(coord.getByText("Currently verified record")).toBeVisible();
    await coord.getByLabel("Reason (shown to the student)").fill("Please provide the backlog statement first.");
    await coord.getByRole("button", { name: "Reject with this reason" }).click();
    await expect(coord.getByText("Rejected.")).toBeVisible();
    await stuA.goto("/student/academics");
    await expect(stuA.getByRole("heading", { name: "Verified record" })).toBeVisible();   // rejection of the update did not disturb it
    await expect(tid(stuA, "v-backlogs").first()).toHaveText("0");

    await stuA.getByLabel("Active backlogs").fill("1");
    await stuA.getByRole("button", { name: "Submit update for review" }).click();
    await expect(stuA.getByText("Submitted for review.")).toBeVisible();
    await coord.goto("/coordinator/verification?q=acadA");
    await coord.getByRole("link", { name: "Test acadA" }).click();
    await coord.getByRole("button", { name: "Verify these values" }).click();
    await expect(coord.getByText("Verified.")).toBeVisible();

    await stuA.goto("/student/academics");
    await expect(tid(stuA, "v-backlogs").first()).toHaveText("1");
    const h = (v: number) => stuA.getByTestId(`history-v${v}`);
    await expect(h(1)).toContainText("Withdrawn");
    await expect(h(2)).toContainText("Rejected");
    await expect(h(3)).toContainText("Superseded");
    await expect(h(4)).toContainText("Rejected");
    await expect(h(5)).toContainText("Verified");
    await expect(h(5)).toContainText("Test coordA");
  });

  test("a coordinator cannot see or decide submissions of another department", async () => {
    expect((await coord.goto(secSubmissionUrl))?.status()).toBe(404);
    expect((await secCoord.goto(aSubmissionUrl))?.status()).toBe(404);
    await coord.goto("/coordinator/verification?q=Sec");
    await expect(coord.getByText("Sec Student")).toHaveCount(0);
    await coord.goto("/coordinator/verification/history");
    await expect(coord.getByText("Sec Student")).toHaveCount(0);
    await secCoord.goto("/coordinator/verification/history");
    await expect(secCoord.getByText("Test acadA")).toHaveCount(0);
    await secCoord.goto(secSubmissionUrl);
    await secCoord.getByRole("button", { name: "Verify these values" }).click();
    await expect(secCoord.getByText("Verified.")).toBeVisible();
    await secCoord.reload();
    await expect(secCoord.getByRole("button", { name: "Verify these values" })).toHaveCount(0);
    await expect(secCoord.getByText("already been decided or withdrawn")).toBeVisible();
  });

  test("a coordinator's roster and pages show academic status; the queue empties as work is done", async () => {
    await coord.goto("/coordinator/students?academics=VERIFIED");
    await expect(coord.getByRole("row", { name: /Test acadA/ })).toContainText("Verified");
    await expect(coord.getByRole("row", { name: /Test acadB/ })).toHaveCount(0);
    await coord.goto("/coordinator/students?academics=PENDING");
    await expect(coord.getByRole("row", { name: /Test acadB/ })).toContainText("Awaiting review");
    await coord.getByRole("link", { name: "Test acadB" }).click();
    await expect(coord.getByRole("heading", { name: "Academic record" })).toBeVisible();
    await expect(coord.getByText("is awaiting review")).toBeVisible();
    await coord.goto("/coordinator");
    await expect(coord.getByTestId("pending-link")).toContainText("1 submission awaiting your review");
  });

  test("administrators have read-only oversight: counts, filters, and a warning when no coordinator can review", async () => {
    await admin.goto("/college/academics");
    await expect(admin.getByRole("heading", { name: "Academic verification" })).toBeVisible();
    expect(Number(await tid(admin, "dept-GEN-verified").innerText())).toBe(1);
    expect(Number(await tid(admin, "dept-GEN-pending").innerText())).toBe(1);
    expect(Number(await tid(admin, "dept-SEC-verified").innerText())).toBe(1);
    const verifiedTotal = Number(await tid(admin, "acad-Verified").innerText());
    await admin.goto("/college/students?academics=VERIFIED");
    await expect(admin.getByTestId("page-summary")).toContainText(`of ${verifiedTotal}`);
    await expect(admin.getByRole("row", { name: /Test acadA/ })).toContainText("Verified");
    await admin.goto("/college");
    expect(Number(await tid(admin, "stat-Verified records").innerText())).toBe(verifiedTotal);

    // no verification controls for administrators
    await admin.goto("/college/students?q=acadB");
    await admin.getByRole("link", { name: "Test acadB" }).click();
    await expect(admin.getByRole("heading", { name: "Academic record" })).toBeVisible();
    await expect(admin.getByRole("button", { name: /Verify|Reject/ })).toHaveCount(0);
    expect((await admin.goto(aSubmissionUrl))?.url()).toMatch(/\/college$/);              // coordinator-only page

    // pending work in a department with no coordinator is flagged
    await admin.goto("/college/staff?q=coordA");
    await admin.getByRole("link", { name: "Test coordA" }).click();
    await admin.getByRole("listitem").filter({ hasText: "GEN" }).getByRole("button", { name: "Remove" }).click();
    await expect(admin.getByText("Not assigned to any department")).toBeVisible();
    await admin.goto("/college/academics");
    await expect(admin.getByText("Submissions are waiting in departments with no active coordinator: GEN (1)")).toBeVisible();
    await admin.goto("/college/staff?q=coordA");
    await admin.getByRole("link", { name: "Test coordA" }).click();
    await admin.getByLabel("Assign to a department").selectOption({ label: "GEN — General Studies" });
    await admin.getByRole("button", { name: "Assign" }).click();
    await expect(admin.getByText("Coordinator assigned.")).toBeVisible();
  });

  test("audit log records the workflow; other roles and colleges are locked out", async ({ browser }) => {
    await admin.goto("/college/audit");
    for (const a of ["Academics submitted", "Academics withdrawn", "Academics verified", "Academics rejected"]) await expect(admin.locator("#action option", { hasText: new RegExp(`^${a}$`) }), a).toHaveCount(1);

    for (const [page, path] of [[stuA, "/coordinator/verification"], [stuA, aSubmissionUrl.replace("http://127.0.0.1:3100", "")], [admin, "/coordinator/verification"], [admin, "/student/academics"], [coord, "/student/academics"]] as [Page, string][]) {
      await page.goto(path);
      await expect(page).not.toHaveURL(/verification|student\/academics/);
    }
    const officer = await newPage(browser); await loginAs(officer, "officerX");
    const home = officer.url();
    for (const path of ["/coordinator/verification", "/student/academics", "/college/academics"]) { await officer.goto(path); await expect(officer).toHaveURL(home); }
    const b = await newPage(browser); await loginAs(b, "adminB");
    await b.goto("/college/academics");
    expect(Number(await tid(b, "acad-Verified").innerText())).toBe(0);
    expect(Number(await tid(b, "acad-Students").innerText())).toBe(0);
  });

  test("academic pages pass the automated accessibility scan and fit a phone screen", async () => {
    const targets: [Page, string[]][] = [
      [stuA, ["/student", "/student/academics"]],
      [coord, ["/coordinator", "/coordinator/verification", "/coordinator/verification/history", aSubmissionUrl.replace("http://127.0.0.1:3100", "")]],
      [admin, ["/college", "/college/academics"]],
    ];
    for (const [page, paths] of targets) for (const path of paths) {
      await page.goto(path); await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), path).toEqual([]);
    }
    for (const [page, paths] of targets) {
      await page.setViewportSize({ width: 360, height: 800 });
      for (const path of paths) {
        await page.goto(path); await page.waitForLoadState("networkidle");
        const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
        expect(o.scroll, `${path} scrollWidth`).toBeLessThanOrEqual(o.inner);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });
});

import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectOn, formAlert, loginAs, seed, expectOnSignIn } from "./helpers";
import { inspect } from "../db/tests/world";

const ORIGIN = "http://127.0.0.1:3100";
const settle = async (page: Page) => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); };
const stat = async (page: Page, id: string) => Number(await page.getByTestId(id).innerText());
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const studentPassword = "Student-Passw0rd!-One";
const coordPassword = "Coord-Passw0rd!-Roster";

const HEADERS = "Reg No,Student Name,Email,Mobile,Branch,Course,Year of Admission,Year of Passing,Specialization";
const row = (n: number, over: Partial<Record<"reg" | "name" | "email" | "dept" | "degree" | "adm" | "pass", string>> = {}) => {
  const i = String(n).padStart(2, "0");
  const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);   // proper CSV quoting for the test data
  return [over.reg ?? `IMP${String(n).padStart(3, "0")}`, q(over.name ?? `Import Student ${i}`), over.email ?? `imp${i}@students.e2e.test`, "9876500000", over.dept ?? (n % 2 ? "STU" : "Students Test Dept"),
          over.degree ?? ["BE", "B.Tech", "b.e."][n % 3], over.adm ?? "2022", over.pass ?? "2026", "AI"].join(",");
};
const csv = (rows: string[]) => Buffer.from([HEADERS, ...rows].join("\n"), "utf8");
const CSV_ROWS = [
  ...Array.from({ length: 30 }, (_, k) => row(k + 1)),
  row(31, { email: "not-an-email" }),                              // problem
  row(32, { dept: "XYZ" }),                                        // problem: unknown department
  row(33, { reg: "IMP001", email: "imp33@students.e2e.test" }),    // duplicate of row 2 in this file
  row(34, { reg: "EXIST001", email: "imp34@students.e2e.test" }),  // duplicate of an existing student
  row(35, { name: '=HYPERLINK("http://evil.test","x") Formula Cell' }), // valid text; must be neutralised in exports
  row(36, { degree: "Wizardry" }),                                 // problem
  row(37, { adm: "2026", pass: "2022" }),                          // problem: year order
];

async function upload(page: Page, name: string, buffer: Buffer) {
  await page.goto("/college/students/import");
  await page.setInputFiles("#file", { name, mimeType: "text/csv", buffer });
  await page.getByRole("button", { name: "Upload and continue" }).click();
}

test.describe.serial("student management", () => {
  let admin: Page;
  let coord: Page;
  let student: Page;
  const open: Page[] = [];
  let existingUrl = "";
  let inviteLink = "";
  const newPage = async (browser: Browser) => { const p = await (await browser.newContext()).newPage(); open.push(p); return p; };

  test.beforeAll(async ({ browser }) => { admin = await newPage(browser); await loginAs(admin, "adminA"); });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("setup: a department for these tests", async () => {
    await admin.goto("/college/departments");
    await admin.getByLabel("Department name").fill("Students Test Dept");
    await admin.getByLabel("Code").fill("STU");
    await admin.getByRole("button", { name: "Add department" }).click();
    await expect(admin.getByText("Department STU created.")).toBeVisible();
  });

  test("the list shows the seeded students and matches the dashboard", async () => {
    await admin.goto("/college/students?q=studenta");                                       // the list is paginated and the seed has more than one page of students
    await expect(admin.getByRole("heading", { name: "Students", exact: true })).toBeVisible();
    await expect(admin.getByRole("row", { name: /studenta@e2e.test/ })).toBeVisible();
    await admin.goto("/college/students");
    const total = (await admin.getByTestId("page-summary").innerText()).match(/of (\d+)/)![1];
    expect(await stat(admin, "stat-Students")).toBe(Number(total));                    // the total at the top of the page equals the list's own count
  });

  test("adding a student: validation, creation, duplicates", async () => {
    await admin.goto("/college/students/new");
    await admin.getByRole("button", { name: "Add student" }).click();
    await settle(admin);
    await expect(admin.locator("#registerNumber-error")).toBeVisible();
    await admin.getByLabel("Register number").fill("EXIST001");
    await admin.getByLabel("Full name").fill("Existing Original");
    await admin.getByLabel("College email").fill("not-an-email");
    await admin.getByLabel("Department").selectOption({ label: "STU — Students Test Dept" });
    await admin.getByLabel("Degree / course").selectOption("B.E.");
    await admin.getByLabel("Admission year").fill("2022");
    await admin.getByLabel("Passing year").fill("2021");
    await admin.getByRole("button", { name: "Add student" }).click();
    await settle(admin);
    await expect(admin.locator("#collegeEmail-error")).toBeVisible();
    await expect(admin.locator("#passingYear-error")).toBeVisible();
    await expect(admin.getByLabel("Full name")).toHaveValue("Existing Original");     // kept
    await expect(admin.getByLabel("Department")).toHaveValue(/.+/);                    // kept

    await admin.getByLabel("College email").fill("exist001@students.e2e.test");
    await admin.getByLabel("Passing year").fill("2026");
    await admin.getByRole("button", { name: "Add student" }).click();
    await admin.waitForURL(/\/college\/students\/[0-9a-f-]{36}\?created=1$/);
    existingUrl = admin.url().split("?")[0];
    await expect(admin.getByText("Student added.")).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Existing Original" })).toBeVisible();

    await admin.goto("/college/students/new");   // duplicates
    const fill = async (reg: string, email: string) => {
      await admin.getByLabel("Register number").fill(reg); await admin.getByLabel("Full name").fill("Dup Person"); await admin.getByLabel("College email").fill(email);
      await admin.getByLabel("Department").selectOption({ label: "STU — Students Test Dept" }); await admin.getByLabel("Degree / course").selectOption("B.E.");
      await admin.getByLabel("Admission year").fill("2022"); await admin.getByLabel("Passing year").fill("2026");
      await admin.getByRole("button", { name: "Add student" }).click(); await settle(admin);
    };
    await fill("exist001", "other@students.e2e.test");
    await expect(formAlert(admin)).toContainText("register number already exists");
    await fill("OTHER001", "EXIST001@students.e2e.test");
    await expect(formAlert(admin)).toContainText("college email already exists");
  });

  test("editing a student; the sign-in email stays editable until an account exists", async () => {
    await admin.goto(existingUrl);
    await admin.getByLabel("Specialization (optional)").fill("Embedded Systems");
    await admin.getByLabel("Phone (optional)").fill("+91 98765 43210");
    await admin.getByRole("button", { name: "Save changes" }).click();
    await expect(admin.getByText("Student saved.")).toBeVisible();
    await admin.reload();
    await expect(admin.getByLabel("Specialization (optional)")).toHaveValue("Embedded Systems");
    await expect(admin.getByLabel("College email")).toBeEditable();
    await expect(admin.getByText("Not invited")).toBeVisible();
  });

  test("single invitation: link shown once; the student joins, signs in, and sees only themself", async ({ browser }) => {
    await admin.goto(existingUrl);
    await admin.getByRole("button", { name: "Create invitation" }).click();
    const panel = admin.getByTestId("invite-link-panel");
    await expect(panel).toBeVisible();
    inviteLink = await panel.getByLabel("One-time link").inputValue();
    expect(inviteLink).toMatch(/\/accept-invite\?token=/);
    await admin.reload();
    await expect(admin.getByTestId("invite-link-panel")).toHaveCount(0);
    await expect(admin.getByText("pending until")).toBeVisible();

    student = await newPage(browser);
    await student.goto(inviteLink);
    await expect(student.getByText("exist001@students.e2e.test")).toBeVisible();
    await student.getByLabel("Full name").fill("Existing Original");
    await student.getByLabel("Choose a password").fill(studentPassword);
    await student.getByLabel("Confirm password").fill(studentPassword);
    await student.getByRole("button", { name: "Create account" }).click();
    await expectOn(student, "/login/student\\?welcome=1");
    await student.getByLabel("Email").fill("exist001@students.e2e.test");
    await student.getByLabel("Password").fill(studentPassword);
    await student.getByRole("button", { name: "Sign in" }).click();
    await expectOn(student, "/student");
    await expect(student.getByText("EXIST001", { exact: true })).toBeVisible();
    await expect(student.getByText("Students Test Dept")).toBeVisible();

    await admin.goto(existingUrl);
    await expect(admin.getByRole("heading", { name: "Existing Original" })).toBeVisible();
    await expect(admin.getByLabel("College email")).toHaveAttribute("readonly", "");          // frozen now
    await expect(admin.getByText("Locked: this student already has an account.")).toBeVisible();
    await expect(admin.getByRole("button", { name: "Create invitation" })).toHaveCount(0);
  });

  test("the student edits only their contact details; identity stays read-only", async () => {
    await student.goto("/student/profile");
    await expect(student.getByText("EXIST001", { exact: true })).toBeVisible();
    await expect(student.getByLabel("Full name")).toHaveCount(0);
    await expect(student.getByLabel("Register number")).toHaveCount(0);
    await student.getByLabel("Phone").fill("letters");
    await student.getByRole("button", { name: "Save contact details" }).click();
    await settle(student);
    await expect(student.locator("#phone-error")).toBeVisible();
    await student.getByLabel("Phone").fill("+91 90000 11111");
    await student.getByLabel("Personal email").fill("exist.personal@example.test");
    await student.getByRole("button", { name: "Save contact details" }).click();
    await expect(student.getByText("Contact details saved.")).toBeVisible();
    await student.reload();
    await expect(student.getByLabel("Phone")).toHaveValue("+91 90000 11111");
    await admin.goto(existingUrl);
    await expect(admin.getByLabel("Phone (optional)")).toHaveValue("+91 90000 11111");
    await expect(admin.getByLabel("Personal email (optional)")).toHaveValue("exist.personal@example.test");
  });

  test("a student cannot open college or coordinator pages", async () => {
    for (const path of ["/college", "/college/students", "/college/students/import", existingUrl.replace(ORIGIN, ""), "/coordinator/students", "/platform"]) {
      await student.goto(path);
      await expectOnSignIn(student, path === "/platform" ? "platform" : "college");   // another area asks for its own sign-in; the student is never switched
    }
  });

  test("CSV upload rejects unusable files with clear messages", async () => {
    const bad: [string, Buffer, RegExp][] = [
      ["binary.csv", Buffer.from([0x41, 0x2c, 0x42, 0x0a, 0x00, 0x01, 0x02]), /binary/],
      ["not-utf8.csv", Buffer.from([0x61, 0x2c, 0x62, 0x0a, 0xff, 0xfe, 0xfd]), /UTF-8/],
      ["header-only.csv", Buffer.from(HEADERS + "\n"), /header row and at least one data row/],
      ["ragged.csv", Buffer.from("a,b\n1,2,3\n"), /more values than there are columns/],
    ];
    for (const [name, buffer, msg] of bad) {
      await upload(admin, name, buffer);
      await expect(formAlert(admin), name).toContainText(msg);
      await expectOn(admin, "/college/students/import\\?error=.*");
    }
    await admin.goto("/college/students/import");
    await admin.getByRole("button", { name: "Upload and continue" }).click();   // no file: the browser blocks it
    await expectOn(admin, "/college/students/import");
  });

  test("the upload endpoint refuses foreign origins, other roles, anonymous callers and oversized bodies", async ({ browser }) => {
    const file = { name: "x.csv", mimeType: "text/csv", buffer: csv([row(1)]) };
    const url = "/college/students/import/upload";
    expect((await admin.request.post(url, { multipart: { file }, headers: { origin: "https://evil.example" }, maxRedirects: 0 })).status()).toBe(403);
    expect((await admin.request.post(url, { multipart: { file }, maxRedirects: 0 })).status()).toBe(403);   // no Origin at all
    expect((await admin.request.post(url, { multipart: { file: { name: "big.csv", mimeType: "text/csv", buffer: Buffer.alloc(3 * 1024 * 1024, "a") } }, headers: { origin: ORIGIN }, maxRedirects: 0 })).status()).toBe(413);
    const anon = await browser.newContext();
    expect((await anon.request.post(ORIGIN + url, { multipart: { file }, headers: { origin: ORIGIN }, maxRedirects: 0 })).status()).toBe(403);
    await anon.close();
    expect((await student.request.post(url, { multipart: { file }, headers: { origin: ORIGIN }, maxRedirects: 0 })).status()).toBe(403);
    const report = await student.request.get("/college/students/import/00000000-0000-4000-8000-000000000000/report");
    expect(report.status()).toBe(403);
  });

  let importUrl = "";
  test("CSV import: upload, column mapping, preview with problems and duplicates", async () => {
    await upload(admin, "students.csv", csv(CSV_ROWS));
    await admin.waitForURL(/\/college\/students\/import\/[0-9a-f-]{36}$/);
    importUrl = admin.url();
    await expect(admin.getByRole("heading", { name: "students.csv" })).toBeVisible();
    await expect(admin.getByText("37 data rows")).toBeVisible();

    // columns are guessed from the headers
    await expect(admin.locator("#map_register_number")).toHaveValue("0");
    await expect(admin.locator("#map_full_name")).toHaveValue("1");
    await expect(admin.locator("#map_college_email")).toHaveValue("2");
    await expect(admin.locator("#map_department")).toHaveValue("4");
    await expect(admin.locator("#map_personal_email")).toHaveValue("");

    // a bad mapping is refused with a clear message
    await admin.locator("#map_full_name").selectOption("0");
    await admin.getByRole("button", { name: "Check the file" }).click();
    await expect(formAlert(admin)).toContainText("same column");
    await admin.locator("#map_full_name").selectOption("1");
    await admin.locator("#map_department").selectOption("");
    await admin.getByRole("button", { name: "Check the file" }).click();
    await expect(formAlert(admin)).toContainText("Department");
    await admin.locator("#map_department").selectOption("4");
    await admin.getByRole("button", { name: "Check the file" }).click();

    await expect(admin.getByText("Review before importing")).toBeVisible();
    expect(await stat(admin, "stat-ready")).toBe(31);
    expect(await stat(admin, "stat-duplicates")).toBe(2);
    expect(await stat(admin, "stat-problems")).toBe(4);
    await expect(admin.getByText("Nothing has been saved yet.")).toBeVisible();
    expect(await admin.request.get("/college/students").then((r) => r.text())).not.toContain("Import Student 01"); // nothing created before commit

    await admin.goto(importUrl + "?status=ERROR");
    await expect(admin.getByRole("row", { name: /not a valid email address/ })).toContainText("32");   // data row 31 = spreadsheet row 32 (the header is row 1)
    await expect(admin.getByText(/Department “XYZ” does not exist/)).toBeVisible();
    await expect(admin.getByText(/Degree “Wizardry” is not recognised/)).toBeVisible();
    await expect(admin.getByText(/Passing year must be after the admission year/)).toBeVisible();
    await admin.goto(importUrl + "?status=DUPLICATE");
    await expect(admin.getByText(/Duplicate of row 2 in this file/)).toBeVisible();
    await expect(admin.getByText(/already exists. Existing records are never changed/)).toBeVisible();
    await admin.goto(importUrl);
    await expect(admin.getByTestId("page-summary")).toContainText("of 37");
    await admin.getByRole("link", { name: "Next" }).click();
    await expect(admin.getByTestId("page-summary")).toContainText("Showing 16–30");
  });

  test("the row report is a CSV with every row, and spreadsheet formulas are neutralised", async () => {
    const res = await admin.request.get(importUrl + "/report");
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("text/csv");
    expect(res.headers()["content-disposition"]).toContain("attachment");
    const text = (await res.text()).replace(/^﻿/, "");
    const lines = text.trim().split("\r\n");
    expect(lines[0]).toBe("Row,Result,Problems," + HEADERS);
    expect(lines).toHaveLength(38);
    expect(text).toContain("not a valid email address");
    expect(text).toContain("'=HYPERLINK(");                         // the leading = was neutralised
    expect(text).not.toMatch(/(^|,)=HYPERLINK/m);
    for (const l of lines.slice(1)) expect(l).not.toMatch(/(^|,)[=+\-@]/);     // no cell starts with a formula character
  });

  test("committing creates only the ready rows, never touches existing students, and cannot be repeated", async () => {
    await admin.goto(importUrl);
    await admin.getByRole("button", { name: "Import 31 students" }).click();
    await expect(admin.getByRole("heading", { name: "Result" })).toBeVisible();
    expect(await stat(admin, "stat-imported")).toBe(31);
    expect(await stat(admin, "stat-duplicates")).toBe(2);
    expect(await stat(admin, "stat-problems")).toBe(4);
    await expect(admin.getByRole("button", { name: /^Import / })).toHaveCount(0);
    await expect(admin.getByRole("heading", { name: "Column mapping" })).toHaveCount(0);   // mapping can no longer be changed

    await admin.goto(existingUrl);
    await expect(admin.getByRole("heading", { name: "Existing Original" })).toBeVisible();   // unchanged by the import's duplicate row
    await admin.goto("/college/students?q=Import%20Student");
    await expect(admin.getByTestId("page-summary")).toContainText("of 30");
    await admin.goto("/college/students?q=Formula%20Cell");
    await expect(admin.getByRole("row", { name: /Formula Cell/ })).toBeVisible();            // stored as plain text
    await admin.goto("/college/students/import");
    await expect(admin.getByRole("row", { name: /students.csv/ })).toContainText("31 imported, 2 duplicate, 4 with problems");
  });

  test("cancelling an import deletes the uploaded data", async () => {
    await upload(admin, "to-cancel.csv", csv([row(60), row(61)]));
    await admin.waitForURL(/\/college\/students\/import\/[0-9a-f-]{36}$/);
    const url = admin.url();
    await admin.getByRole("button", { name: "Check the file" }).click();
    await expect(admin.getByText("Review before importing")).toBeVisible();
    await admin.getByRole("button", { name: "Cancel this import" }).click();
    await expectOn(admin, "/college/students/import");
    await admin.goto(url);
    await expect(admin.getByText("This import was cancelled and its uploaded data was deleted.")).toBeVisible();
    await expect(admin.getByRole("row", { name: /Import Student/ })).toHaveCount(0);
    await admin.goto("/college/students?q=IMP060");
    await expect(admin.getByText("No students found")).toBeVisible();
  });

  test("filters, search and pagination; account statuses; department counts", async () => {
    await admin.goto("/college/students?q=Import%20Student");
    await expect(admin.getByRole("row")).toHaveCount(16);      // header + 15
    await expect(admin.getByTestId("page-summary")).toContainText("Showing 1–15 of 30");
    await admin.getByRole("link", { name: "Next" }).click();
    await expect(admin.getByTestId("page-summary")).toContainText("Showing 16–30 of 30");
    await admin.goto("/college/students?q=imp07");
    await expect(admin.getByRole("row", { name: /Import Student 07/ })).toBeVisible();
    await expect(admin.getByRole("row")).toHaveCount(2);
    await admin.goto("/college/students?q=100%25_%5C");
    await expect(admin.getByText("No students found")).toBeVisible();
    await admin.goto("/college/students?year=2026&account=NOT_INVITED&q=Import");
    await expect(admin.getByTestId("page-summary")).toContainText("of 30");
    await admin.goto("/college/students?account=ACTIVE&q=Existing");
    await expect(admin.getByRole("row", { name: /Existing Original/ })).toContainText("Active");

    await admin.goto("/college/departments");
    expect(Number(await admin.getByTestId("dept-students-STU").innerText())).toBe(32);      // 31 imported + EXIST001
    await admin.goto("/college");
    await expect(admin.getByTestId("stat-Not yet invited")).toBeVisible();
  });

  test("bulk invitation: links are produced once, downloadable as a safe CSV, and each works", async ({ browser }) => {
    await admin.goto("/college/students");
    const stuId = await admin.locator("#dept option", { hasText: "STU" }).getAttribute("value");
    await admin.goto(`/college/students?q=Import%20Student&dept=${stuId}`);
    const n = await stat(admin, "invitable-count");
    expect(n).toBe(30);
    await admin.getByRole("button", { name: "Create invitations for matching students" }).click();
    await expect(admin.getByText("30 invitation(s) created.")).toBeVisible();
    const links = admin.getByTestId("bulk-links");
    await expect(links).toContainText("These links are shown only now");
    const [download] = await Promise.all([admin.waitForEvent("download"), links.getByRole("button", { name: "Download links as CSV" }).click()]);
    const body = (await (await import("node:fs/promises")).readFile((await download.path())!, "utf8")).replace(/^﻿/, "");
    const lines = body.trim().split("\r\n");
    expect(lines[0]).toBe("Register number,Name,College email,Invitation link");
    expect(lines).toHaveLength(31);
    expect(body).toMatch(/accept-invite\?token=[A-Za-z0-9_-]{43}/);
    for (const l of lines.slice(1)) expect(l).not.toMatch(/(^|,)[=+\-@]/);

    const firstLink = lines[1].split(",").pop()!;
    const p = await newPage(browser);
    await p.goto(firstLink);
    await p.getByLabel("Full name").fill("Import Student 01");
    await p.getByLabel("Choose a password").fill(studentPassword);
    await p.getByLabel("Confirm password").fill(studentPassword);
    await p.getByRole("button", { name: "Create account" }).click();
    await expectOn(p, "/login/student\\?welcome=1");

    await admin.reload();
    expect(await stat(admin, "invitable-count")).toBe(0);                                     // nobody left to invite
    await expect(admin.getByRole("button", { name: "Create invitations for matching students" })).toBeDisabled();
    await admin.goto("/college/students?q=Import%20Student&account=INVITED");
    await expect(admin.getByTestId("page-summary")).toContainText("of 29");
    await admin.goto("/college/students?q=Import%20Student&account=ACTIVE");
    await expect(admin.getByTestId("page-summary")).toContainText("of 1");
  });

  test("a coordinator sees only the students of their assigned departments", async ({ browser }) => {
    // invite + create a coordinator through the staff screen
    await admin.goto("/college/staff");
    await admin.getByLabel("Email", { exact: true }).fill("roster.coord@e2e.test");
    await admin.getByLabel("Role", { exact: true }).last().selectOption("COORDINATOR");
    await admin.getByLabel("Department", { exact: true }).selectOption({ label: "STU · Students Test Dept" });
    await admin.getByRole("button", { name: "Create invitation" }).click();
    const link = await admin.getByTestId("invite-link-panel").getByLabel("One-time link").inputValue();
    coord = await newPage(browser);
    await coord.goto(link);
    await coord.getByLabel("Full name").fill("Roster Coordinator");
    await coord.getByLabel("Choose a password").fill(coordPassword);
    await coord.getByLabel("Confirm password").fill(coordPassword);
    await coord.getByRole("button", { name: "Create account" }).click();
    await expectOn(coord, "/login/college\\?welcome=1");
    await coord.getByLabel("Email").fill("roster.coord@e2e.test");
    await coord.getByLabel("Password").fill(coordPassword);
    await coord.getByRole("button", { name: "Sign in" }).click();
    await expectOn(coord, "/coordinator");

    await coord.goto("/coordinator");
    await expect(coord.getByTestId("students-STU")).toContainText("32 students");
    await coord.goto("/coordinator/students");
    await expect(coord.getByTestId("page-summary")).toContainText("of 32");
    await expect(coord.getByText("studenta@e2e.test")).toHaveCount(0);                       // GEN department students are invisible
    await expect(coord.getByText("Has account")).toBeVisible();
    await coord.goto("/coordinator/students?q=Existing");
    await expect(coord.getByRole("row", { name: /EXIST001/ })).toBeVisible();
    await coord.getByRole("link", { name: "Existing Original" }).click();
    await expect(coord.getByRole("heading", { name: "Existing Original" })).toBeVisible();
    await expect(coord.getByText("Read-only.")).toBeVisible();
    await expect(coord.getByRole("heading", { name: "Drive history and placement" })).toBeVisible();
    await expect(coord.getByText("has not registered for any drive")).toBeVisible();
    // a student of a department that is NOT assigned to this coordinator does not exist for them
    await admin.goto("/college/students?q=studentA");
    const genHref = await admin.getByRole("link", { name: "Test studentA" }).getAttribute("href");
    expect((await coord.goto(genHref!.replace("/college/", "/coordinator/")))?.status()).toBe(404);
    await coord.goto("/coordinator/students?dept=00000000-0000-4000-8000-000000000000");
    await expect(coord.getByText("No students", { exact: true })).toBeVisible();                              // a foreign/unknown department filter yields nothing, not an error

    for (const path of ["/college/students", "/college/students/new", "/college/students/import"]) { await coord.goto(path); await expectOnSignIn(coord, "college"); }   // an administrator's pages ask for the administrator's sign-in

    await admin.goto("/college/staff?q=Roster");        // unassigning removes the roster immediately
    await admin.getByRole("link", { name: "Roster Coordinator" }).click();
    await admin.getByRole("listitem").filter({ hasText: "STU" }).getByRole("button", { name: "Remove" }).click();
    await expect(admin.getByText("Not assigned to any department")).toBeVisible();
    await coord.goto("/coordinator/students");
    await expect(coord.getByText("No students", { exact: true })).toBeVisible();
  });

  test("another college's administrator sees no students and cannot reach this college's records or imports", async ({ browser }) => {
    const b = await newPage(browser);
    await loginAs(b, "adminB");
    await b.goto("/college/students");
    await expect(b.getByText("No students found")).toBeVisible();
    await expect(b.getByText("Import Student")).toHaveCount(0);
    expect((await b.goto(existingUrl.replace(ORIGIN, "")))?.status()).toBe(404);
    expect((await b.goto(importUrl.replace(ORIGIN, "")))?.status()).toBe(404);
    expect((await b.request.get(importUrl.replace(ORIGIN, "") + "/report"))?.status()).toBe(404);
    await b.goto("/college/students");
    expect(await stat(b, "stat-Students")).toBe(0);
  });

  test("officers cannot open student administration", async ({ browser }) => {
    const p = await newPage(browser);
    await loginAs(p, "officerX");
    const home = p.url();
    for (const path of ["/college/students", "/college/students/new", "/college/students/import", "/coordinator/students"]) { await p.goto(path); await expectOnSignIn(p, "college"); void home; }   // each role has its own session: another role's pages ask for that sign-in
  });

  test("student pages pass the automated accessibility scan and fit a phone screen", async () => {
    const pages: [Page, string[]][] = [
      [admin, ["/college/students", "/college/students/new", existingUrl.replace(ORIGIN, ""), "/college/students/import", importUrl.replace(ORIGIN, "")]],
      [student, ["/student", "/student/profile"]],
    ];
    for (const [page, paths] of pages) {
      for (const path of paths) {
        await page.goto(path); await page.waitForLoadState("networkidle");
        const res = await new AxeBuilder({ page }).withTags(TAGS).analyze();
        expect(res.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), path).toEqual([]);
      }
    }
    for (const [page, paths] of pages) {
      await page.setViewportSize({ width: 360, height: 800 });
      for (const path of paths) {
        await page.goto(path); await page.waitForLoadState("networkidle");
        const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
        expect(o.scroll, `${path} scrollWidth`).toBeLessThanOrEqual(o.inner);
      }
      await page.setViewportSize({ width: 1280, height: 720 });
    }
    void seed;
  });

  test("register numbers are shown and stored in capitals however they are typed; names keep their case", async () => {
    await admin.goto("/college/students/new");
    const reg = admin.getByLabel("Register number");
    await reg.pressSequentially("23ai-c9z");
    await expect(reg).toHaveValue("23AI-C9Z");                                    // shown in capitals while typing
    await admin.getByLabel("Full name").fill("Asha de Souza");
    await admin.getByLabel("College email").fill("Norm.CASE@Students.E2E.test");
    await admin.getByLabel("Department").selectOption({ label: "STU — Students Test Dept" }); await admin.getByLabel("Degree / course").selectOption("B.E.");
    await admin.getByLabel("Admission year").fill("2022"); await admin.getByLabel("Passing year").fill("2026");
    await admin.getByRole("button", { name: "Add student" }).click(); await settle(admin);
    await expect(admin.getByRole("heading", { name: "Asha de Souza" })).toBeVisible();      // the name is not upper-cased
    const [row] = await inspect<{ r: string; e: string }>("SELECT register_number::text AS r, college_email::text AS e FROM students WHERE full_name = 'Asha de Souza'");
    expect(row.r).toBe("23AI-C9Z"); expect(row.e).toBe("norm.case@students.e2e.test");
    await admin.goto("/college/students?q=23ai-c9z");                                       // a lower-case search finds the same record
    await expect(admin.getByRole("link", { name: "Asha de Souza" })).toBeVisible();
  });
});

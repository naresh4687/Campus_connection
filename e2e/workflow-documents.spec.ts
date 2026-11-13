import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { inspect } from "../db/tests/world";
import { expectOn, formAlert, loginAs } from "./helpers";
import { signedDownloadUrl } from "../src/server/storage/s3";

const ORIGIN = "http://127.0.0.1:3100";
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const text = (s: string) => Buffer.from(s, "utf8");
let counter = 0;
const pdf = (label = "doc") => text(`%PDF-1.7\n1 0 obj << /Title (${label} ${++counter} ${Math.random()}) >> endobj\n%%EOF\n`);
const png = () => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(String(Math.random())), text("IEND"), Buffer.from([0xae, 0x42, 0x60, 0x82])]);
const jpg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from(String(Math.random())), Buffer.from([0xff, 0xd9])]);

async function upload(p: Page, kind: string, name: string, mimeType: string, buffer: Buffer) {
  await p.goto("/student/documents");
  await p.getByLabel("Kind of document").selectOption(kind);
  await p.setInputFiles("#file", { name, mimeType, buffer });
  await p.getByRole("button", { name: "Upload" }).click();
  await p.waitForLoadState("networkidle");
}
const docId = async (p: Page, name: string) => (await p.getByRole("link", { name, exact: true }).first().getAttribute("href"))!.match(/documents\/([0-9a-f-]{36})\/download/)![1];

test.describe.serial("private documents", () => {
  let admin: Page; let docA: Page; let docB: Page; let coord: Page;
  const open: Page[] = [];
  let resumeId = ""; let marksheetId = ""; let certId = "";
  const newPage = async (browser: Browser) => { const p = await (await browser.newContext()).newPage(); open.push(p); return p; };

  test.beforeAll(async ({ browser }) => {
    admin = await newPage(browser); await loginAs(admin, "adminA");
    docA = await newPage(browser); await loginAs(docA, "docA");
    docB = await newPage(browser); await loginAs(docB, "docB");
    coord = await newPage(browser); await loginAs(coord, "coordA");
  });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("setup: the coordinator covers GEN; a second department exists to move a student into", async () => {
    await admin.goto("/college/staff?q=coordA");
    await admin.getByRole("link", { name: "Test coordA" }).click();
    await expect(admin.getByRole("heading", { name: "Departments", level: 2 })).toBeVisible();   // wait for the page before deciding
    if ((await admin.getByRole("listitem").filter({ hasText: "GEN" }).count()) === 0) {
      await admin.getByLabel("Assign to a department").selectOption({ label: "GEN — General Studies" });
      await admin.getByRole("button", { name: "Assign" }).click();
      await expect(admin.getByText("Coordinator assigned.")).toBeVisible();
    }
    await admin.goto("/college/departments");
    await admin.getByLabel("Department name").fill("Isolated Studies");
    await admin.getByLabel("Code").fill("ISO");
    await admin.getByRole("button", { name: "Add department" }).click();
    await expect(admin.getByText("Department ISO created.")).toBeVisible();
  });

  test("a student uploads a resume, a mark sheet and a certificate; the list shows kind, size and review state", async () => {
    await upload(docA, "RESUME", "My Resume.pdf", "application/pdf", pdf("resume"));
    await expect(docA.getByText("Document uploaded.")).toBeVisible();
    await upload(docA, "MARKSHEET", "semester-5.png", "image/png", png());
    await upload(docA, "CERTIFICATE", "hackathon.jpg", "image/jpeg", jpg());
    const list = docA.getByRole("list", { name: "Your documents" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    await expect(docA.getByTestId("doc-My Resume.pdf")).toContainText("No review needed");
    await expect(docA.getByTestId("doc-semester-5.png")).toContainText("Awaiting review");
    await expect(docA.getByTestId("doc-semester-5.png")).toContainText("PNG image");
    await expect(docA.getByTestId("doc-hackathon.jpg")).toContainText("JPEG image");
    await expect(docA.getByTestId("doc-My Resume.pdf")).toContainText("not virus-scanned");
    resumeId = await docId(docA, "My Resume.pdf"); marksheetId = await docId(docA, "semester-5.png"); certId = await docId(docA, "hackathon.jpg");
  });

  test("unusable files are refused by content, with clear messages, and nothing is stored", async () => {
    const before = await docA.getByRole("list", { name: "Your documents" }).getByRole("listitem").count();
    const cases: [string, string, string, Buffer, RegExp][] = [
      ["RESUME", "page.pdf", "application/pdf", text("<html><script>alert(1)</script></html>"), /Only PDF, PNG and JPEG/],
      ["RESUME", "renamed.png", "image/png", pdf(), /ends in “\.png”.*PDF/],
      ["RESUME", "cut-off.pdf", "application/pdf", text("%PDF-1.7\n1 0 obj << /Truncated true"), /complete and not corrupted/],
      ["MARKSHEET", "program.pdf", "application/pdf", Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), /Only PDF, PNG and JPEG/],
      ["OTHER", "double.pdf.exe", "application/pdf", pdf(), /ends in “\.exe”/],
      ["OTHER", "lie.pdf", "image/png", pdf(), /declared type/],
    ];
    for (const [kind, name, mime, buf, msg] of cases) {
      await upload(docA, kind, name, mime, buf);
      await expect(formAlert(docA), name).toContainText(msg);
    }
    await docA.goto("/student/documents");
    await expect(docA.getByRole("list", { name: "Your documents" }).getByRole("listitem")).toHaveCount(before);
  });

  test("an oversized file is stopped in the browser, and the server refuses it too", async () => {
    await docA.goto("/student/documents");
    await docA.getByLabel("Kind of document").selectOption("OTHER");
    await docA.setInputFiles("#file", { name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.concat([text("%PDF-1.7\n"), Buffer.alloc(5 * 1024 * 1024 + 10, 65), text("\n%%EOF\n")]) });
    await expect(formAlert(docA)).toContainText("larger than 5 MB");
    const res = await docA.request.post("/student/documents/upload", { multipart: { kind: "OTHER", file: { name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(6 * 1024 * 1024, 65) } }, headers: { origin: ORIGIN }, maxRedirects: 0 });
    expect(res.status()).toBe(413);
  });

  test("the upload endpoint refuses foreign origins, other roles and anonymous callers", async ({ browser }) => {
    const mp = { kind: "RESUME", file: { name: "x.pdf", mimeType: "application/pdf", buffer: pdf() } };
    expect((await docA.request.post("/student/documents/upload", { multipart: mp, headers: { origin: "https://evil.example" }, maxRedirects: 0 })).status()).toBe(403);
    expect((await coord.request.post("/student/documents/upload", { multipart: mp, headers: { origin: ORIGIN }, maxRedirects: 0 })).status()).toBe(403);
    expect((await admin.request.post("/student/documents/upload", { multipart: mp, headers: { origin: ORIGIN }, maxRedirects: 0 })).status()).toBe(403);
    const anon = await browser.newContext();
    expect((await anon.request.post(ORIGIN + "/student/documents/upload", { multipart: mp, headers: { origin: ORIGIN }, maxRedirects: 0 })).status()).toBe(403);
    await anon.close();
  });

  test("a download is a 60-second signed link; the file arrives as an attachment; the raw object URL is refused", async () => {
    const res = await docA.request.get(`/documents/${resumeId}/download`, { maxRedirects: 0 });
    expect(res.status()).toBe(302);
    expect(res.headers()["cache-control"]).toContain("no-store");
    const location = res.headers()["location"];
    const u = new URL(location);
    expect(u.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(u.searchParams.get("X-Amz-Signature")).toBeTruthy();
    const file = await fetch(location);                                  // no cookies: the signature is the only credential
    expect(file.status).toBe(200);
    expect(file.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect((await file.text()).startsWith("%PDF-")).toBe(true);
    expect((await fetch(u.origin + u.pathname)).status).toBe(403);       // the object itself is not public
    expect((await fetch(location.replace(/X-Amz-Signature=[0-9a-f]+/, "X-Amz-Signature=" + "0".repeat(64)))).status).toBe(403);
    // clicking the link in the UI downloads the file
    await docA.goto("/student/documents");
    const [dl] = await Promise.all([docA.waitForEvent("download"), docA.getByRole("link", { name: "My Resume.pdf", exact: true }).click()]);
    expect(dl.suggestedFilename()).toBe("My Resume.pdf");
  });

  test("nobody else can download it: other students, administrators, officers, other colleges, anonymous visitors", async ({ browser }) => {
    const url = `/documents/${marksheetId}/download`;
    expect((await docB.request.get(url, { maxRedirects: 0 })).status()).toBe(404);
    expect((await admin.request.get(url, { maxRedirects: 0 })).status()).toBe(403);
    const officer = await newPage(browser); await loginAs(officer, "officerX");
    expect((await officer.request.get(url, { maxRedirects: 0 })).status()).toBe(404);   // officers may open only the résumé of a student registered for a drive; anything else is "not found"
    const b = await newPage(browser); await loginAs(b, "adminB");
    expect((await b.request.get(url, { maxRedirects: 0 })).status()).toBe(404);
    const anon = await browser.newContext();
    const r = await anon.request.get(ORIGIN + url, { maxRedirects: 0 });
    expect(r.status()).toBe(303);
    expect(r.headers()["location"]).toMatch(/\/login$/);
    await anon.close();
    expect((await docA.request.get("/documents/not-a-uuid/download", { maxRedirects: 0 })).status()).toBe(404);
    expect((await docA.request.get("/documents/00000000-0000-4000-8000-000000000000/download", { maxRedirects: 0 })).status()).toBe(404);
    await docB.goto("/student/documents");
    await expect(docB.getByText("semester-5.png")).toHaveCount(0);        // another student's list never shows it
  });

  test("a coordinator of the student's department can open mark sheets and certificates — never the resume — and the student sees who looked", async () => {
    expect((await coord.request.get(`/documents/${marksheetId}/download`, { maxRedirects: 0 })).status()).toBe(302);
    expect((await coord.request.get(`/documents/${certId}/download`, { maxRedirects: 0 })).status()).toBe(302);
    expect((await coord.request.get(`/documents/${resumeId}/download`, { maxRedirects: 0 })).status()).toBe(404);
    await docA.goto("/student/documents");
    const item = docA.getByTestId("doc-semester-5.png");
    await item.getByText(/History \(/).click();
    await expect(item.getByRole("list", { name: "Document history" })).toContainText("Viewed by Test coordA (coordinator)");
    await expect(docA.getByTestId("doc-My Resume.pdf")).not.toContainText("Viewed by");
    // the coordinator's view of the student never lists the resume
    await coord.goto("/coordinator/students?q=docA");
    await coord.getByRole("link", { name: "Test docA" }).click();
    await expect(coord.getByRole("heading", { name: "Documents" })).toBeVisible();
    await expect(coord.getByRole("link", { name: "semester-5.png", exact: true })).toBeVisible();
    await expect(coord.getByText("My Resume.pdf")).toHaveCount(0);
  });

  test("access follows the department: moving the student away removes the coordinator's access immediately", async () => {
    await admin.goto("/college/students?q=docA");
    await admin.getByRole("link", { name: "Test docA" }).click();
    await admin.waitForURL(/\/college\/students\/[0-9a-f-]{36}$/);
    const studentUrl = admin.url();
    await admin.getByLabel("Department").selectOption({ label: "ISO — Isolated Studies" });
    await admin.getByRole("button", { name: "Save changes" }).click();
    await expect(admin.getByText("Student saved.")).toBeVisible();
    expect((await coord.request.get(`/documents/${marksheetId}/download`, { maxRedirects: 0 })).status()).toBe(404);
    await coord.goto("/coordinator/documents");
    await expect(coord.getByText("semester-5.png")).toHaveCount(0);
    await admin.goto(studentUrl);
    await admin.getByLabel("Department").selectOption({ label: "GEN — General Studies" });
    await admin.getByRole("button", { name: "Save changes" }).click();
    await expect(admin.getByText("Student saved.")).toBeVisible();
    expect((await coord.request.get(`/documents/${marksheetId}/download`, { maxRedirects: 0 })).status()).toBe(302);
  });

  test("administrators have no access to documents anywhere in their console", async () => {
    await admin.goto("/college/students?q=docA");
    await admin.getByRole("link", { name: "Test docA" }).click();
    await expect(admin.getByRole("heading", { name: "Documents" })).toHaveCount(0);
    await expect(admin.getByText("semester-5.png")).toHaveCount(0);
    for (const path of ["/coordinator/documents", "/student/documents"]) { await admin.goto(path); await expectOn(admin, "/college"); }
  });

  test("the coordinator reviews pending documents: a reason is needed to reject; the student sees the outcome", async () => {
    await coord.goto("/coordinator/documents");
    const queue = coord.getByRole("list", { name: "Pending documents" });
    await expect(queue.getByText("hackathon.jpg")).toBeVisible();
    await expect(coord.getByText("My Resume.pdf")).toHaveCount(0);
    const cert = queue.locator("div").filter({ hasText: "hackathon.jpg" }).first();
    await cert.getByRole("button", { name: "Reject" }).click();
    await expect(formAlert(coord)).toContainText("at least 5 characters");
    await cert.getByLabel("Reason (needed to reject)").fill("The scan is cropped; please upload the full page.");
    await cert.getByRole("button", { name: "Reject" }).click();
    await expect(coord.getByText("Document rejected. The student can see your reason.")).toBeVisible();
    const mark = queue.locator("div").filter({ hasText: "semester-5.png" }).first();
    await mark.getByRole("button", { name: "Verify" }).click();
    await expect(coord.getByText("Document verified.")).toBeVisible();

    await docA.goto("/student/documents");
    await expect(docA.getByTestId("doc-hackathon.jpg")).toContainText("Rejected");
    await expect(docA.getByTestId("doc-hackathon.jpg")).toContainText("The scan is cropped; please upload the full page.");
    await expect(docA.getByTestId("doc-semester-5.png")).toContainText("Verified");
    await expect(docA.getByTestId("doc-semester-5.png")).toContainText("Test coordA");
    await coord.goto("/coordinator/documents");
    await expect(coord.getByText("Nothing to review")).toBeVisible();
  });

  test("evidence: the student attaches a mark sheet; the reviewer sees and opens it; attached evidence cannot be deleted", async () => {
    await docA.goto("/student/academics");
    await docA.getByLabel("Overall CGPA (out of 10)", { exact: true }).fill("8.4");
    await docA.getByLabel("10th percentage", { exact: true }).fill("91");
    await docA.getByLabel("12th percentage", { exact: true }).fill("89");
    await docA.getByLabel("Active backlogs", { exact: true }).fill("0");
    await docA.getByLabel("Historical arrears", { exact: true }).fill("0");
    await expect(docA.getByLabel(/semester-5.png/)).toBeVisible();
    await docA.getByLabel(/semester-5.png/).check();
    await docA.getByRole("button", { name: "Submit for review" }).click();
    await expect(docA.getByText("Submitted for review.")).toBeVisible();
    await expect(docA.getByRole("link", { name: "semester-5.png" })).toBeVisible();      // evidence listed on the pending submission

    await coord.goto("/coordinator/verification?q=docA");
    await coord.getByRole("link", { name: "Test docA" }).click();
    await expect(coord.getByRole("heading", { name: "Evidence attached by the student" })).toBeVisible();
    await expect(coord.getByRole("list", { name: "Evidence" }).getByRole("link", { name: "semester-5.png" })).toBeVisible();
    expect((await coord.request.get(`/documents/${marksheetId}/download`, { maxRedirects: 0 })).status()).toBe(302);

    await docA.goto("/student/documents");
    await docA.getByTestId("doc-semester-5.png").getByRole("button", { name: "Delete" }).click();
    await expect(formAlert(docA)).toContainText("attached as evidence");
    await expect(docA.getByTestId("doc-semester-5.png")).toBeVisible();
  });

  test("deleting an unattached document removes the record and the stored bytes", async () => {
    const [row] = await inspect<{ storage_key: string }>("SELECT storage_key FROM documents WHERE id = $1", [resumeId]);
    expect((await fetch(await signedDownloadUrl(row.storage_key, "x.pdf", "application/pdf"))).status).toBe(200);   // present before
    await docA.goto("/student/documents");
    await docA.getByTestId("doc-My Resume.pdf").getByRole("button", { name: "Delete" }).click();
    await expect(docA.getByRole("list", { name: "Your documents" }).getByText("My Resume.pdf")).toHaveCount(0);
    await expect(docA.getByRole("list", { name: "Deleted documents" }).getByText("My Resume.pdf")).toBeVisible();
    expect((await fetch(await signedDownloadUrl(row.storage_key, "x.pdf", "application/pdf"))).status).toBe(404);   // bytes are gone
    expect((await docA.request.get(`/documents/${resumeId}/download`, { maxRedirects: 0 })).status()).toBe(404);
    const [after] = await inspect<{ status: string; purged_at: Date | null }>("SELECT status, purged_at FROM documents WHERE id = $1", [resumeId]);
    expect(after.status).toBe("DELETED");
    expect(after.purged_at).not.toBeNull();
  });

  test("the audit log records document activity without file names", async () => {
    await admin.goto("/college/audit");
    for (const a of ["Document uploaded", "Document deleted", "Document verified", "Document rejected"]) await expect(admin.locator("#action option", { hasText: new RegExp(`^${a}$`) }), a).toHaveCount(1);
    const rows = await inspect<{ metadata: unknown }>("SELECT metadata FROM audit_log WHERE action LIKE 'DOCUMENT_%'");
    expect(JSON.stringify(rows)).not.toMatch(/semester|hackathon|my resume|\.pdf|\.png|\.jpg/i);   // only the kind is recorded, never a file name
  });

  test("document pages pass the automated accessibility scan and fit a phone screen", async () => {
    const targets: [Page, string[]][] = [[docA, ["/student/documents"]], [coord, ["/coordinator/documents"]]];
    for (const [page, paths] of targets) for (const path of paths) {
      await page.goto(path); await page.waitForLoadState("networkidle");
      const r = await new AxeBuilder({ page }).withTags(TAGS).analyze();
      expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`), path).toEqual([]);
      await page.setViewportSize({ width: 360, height: 800 });
      await page.goto(path); await page.waitForLoadState("networkidle");
      const o = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
      expect(o.scroll, `${path} scrollWidth`).toBeLessThanOrEqual(o.inner);
      await page.setViewportSize({ width: 1280, height: 720 });
    }
  });
});

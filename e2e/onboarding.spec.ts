import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectOn, expectOnSignIn, formAlert, loginAs, seed } from "./helpers";

const unique = () => Math.random().toString(36).slice(2, 8);

async function fillApplication(page: Page, over: Record<string, string> = {}) {
  const v = {
    name: "Test College " + unique(), officialEmail: `principal-${unique()}@college.e2e.test`, website: "https://college.e2e.test",
    address: "12 Example Road", district: "Coimbatore", contactPerson: "Dr Test Principal", phone: "+91 98765 43210", approxStudents: "1200",
    state: "Tamil Nadu", collegeType: "PRIVATE", ...over,
  };
  await page.goto("/apply");
  await page.getByLabel("College name").fill(v.name);
  await page.getByLabel("Official email").fill(v.officialEmail);
  await page.getByLabel("Website").fill(v.website);
  await page.getByLabel("Address").fill(v.address);
  await page.getByLabel("State / union territory").selectOption(v.state);
  await page.getByLabel("District").fill(v.district);
  await page.getByLabel("Contact person").fill(v.contactPerson);
  await page.getByLabel("Phone").fill(v.phone);
  await page.getByLabel("College type").selectOption(v.collegeType);
  await page.getByLabel("Approximate student strength").fill(v.approxStudents);
  return v;
}
// React resets a form when its action returns; let that commit land before touching the fields again.
const settle = async (page: Page) => { await page.waitForLoadState("networkidle"); await page.waitForTimeout(300); };
const submit = async (page: Page) => { await page.getByRole("button", { name: "Submit application" }).click(); await settle(page); };

test.describe("public website", () => {
  const PAGES: [string, string][] = [
    ["/", "Every placement, on record."], ["/features", "Features"], ["/how-it-works", "How it works"],
    ["/apply", "Apply as a college"], ["/contact", "Contact"], ["/privacy", "Privacy policy"], ["/terms", "Terms of service"], ["/login", "Sign in"],
  ];
  for (const [path, heading] of PAGES) {
    test(`${path} renders`, async ({ page }) => {
      const res = await page.goto(path);
      expect(res?.status()).toBe(200);
      await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
    });
  }

  test("header and footer navigation work", async ({ page }) => {
    await page.goto("/");
    for (const [name, path] of [["Features", "/features"], ["How it works", "/how-it-works"], ["Contact", "/contact"]] as const) {
      await page.getByRole("banner").getByRole("link", { name }).click();
      await expectOn(page, path);
    }
    await page.getByRole("banner").getByRole("link", { name: "Apply as a college" }).click();
    await expectOn(page, "/apply");
    await page.getByRole("contentinfo").getByRole("link", { name: "Privacy policy" }).click();
    await expectOn(page, "/privacy");
    await page.getByRole("contentinfo").getByRole("link", { name: "Terms of service" }).click();
    await expectOn(page, "/terms");
    await page.getByRole("banner").getByRole("link", { name: "Sign in" }).click();
    await expectOnSignIn(page);
  });

  test("features page is honest: lists what is available and, separately, what is not included yet", async ({ page }) => {
    await page.goto("/features");
    const available = page.getByRole("list", { name: "Available now" });
    await expect(available.getByRole("listitem")).toHaveCount(12);
    await expect(available).toContainText("Eligibility engine");
    await expect(available).toContainText("Offers and verified placements");
    const missing = page.getByRole("list", { name: "Not included yet" });
    await expect(missing).toContainText("Email or SMS notifications");
    await expect(missing).toContainText("virus scanning");
    await expect(missing).toContainText("not yet been tried with a live AI provider");
  });

  test("makes no invented social proof or usage claims", async ({ page }) => {
    for (const path of ["/", "/features", "/how-it-works"]) {
      await page.goto(path);
      const text = (await page.locator("main").innerText()).toLowerCase();
      for (const banned of ["testimonial", "trusted by", "our customers", "colleges use", "% of", "students placed", "case study", "★"]) expect(text, `${path}: ${banned}`).not.toContain(banned);
    }
  });
});

test.describe("college application form", () => {
  test("empty and invalid input is rejected with field errors and kept values", async ({ page }) => {
    await page.goto("/apply");
    await submit(page);
    await expect(formAlert(page)).toContainText("Please correct the highlighted fields");
    await expect(page.locator("#name-error")).toBeVisible();

    const v = await fillApplication(page, { website: "javascript:alert(1)", approxStudents: "3" });
    await submit(page);
    await expect(page.locator("#website-error")).toContainText("http");
    await expect(page.locator("#approxStudents-error")).toBeVisible();
    await expect(page.getByLabel("College name")).toHaveValue(v.name);
    await expect(page.getByLabel("State / union territory")).toHaveValue("Tamil Nadu");
    await expectOn(page, "/apply");
  });

  test("a valid application is stored and gives the applicant a private status link", async ({ page }) => {
    const v = await fillApplication(page);
    await submit(page);
    await expect(page).toHaveURL(/\/apply\/status\?ref=[A-Za-z0-9_-]{43}&new=1$/);
    await expect(page.getByText("Application submitted.")).toBeVisible();
    await expect(page.getByText(v.name)).toBeVisible();
    await expect(page.getByText("Submitted", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("The team has not started reviewing it yet")).toBeVisible();
  });

  test("a second application with the same official email is refused; a bad status link finds nothing", async ({ page }) => {
    const v = await fillApplication(page);
    await submit(page);
    await expect(page).toHaveURL(/status/);
    await fillApplication(page, { officialEmail: v.officialEmail.toUpperCase() });
    await submit(page);
    await expect(formAlert(page)).toContainText("already on file");
    await page.goto("/apply/status?ref=" + "A".repeat(43));
    await expect(formAlert(page)).toContainText("No application was found");
    await page.goto("/apply/status?ref=garbage");
    await expect(formAlert(page)).toContainText("No application was found");
  });

  test("per-email rate limit stops repeated submissions", async ({ page }) => {
    const email = `ratelimit-${unique()}@college.e2e.test`;
    for (let i = 0; i < 3; i++) { await fillApplication(page, { officialEmail: email }); await submit(page); await page.waitForLoadState(); }
    await fillApplication(page, { officialEmail: email });
    await submit(page);
    await expect(formAlert(page)).toContainText("Too many requests");
  });

  test("bots filling the hidden honeypot field get nothing stored", async ({ page }) => {
    await fillApplication(page, { name: "Honeypot Probe College" });
    await page.evaluate(() => { (document.querySelector('input[name="contactUrl"]') as HTMLInputElement).value = "http://spam.example"; });
    await submit(page);
    await expect(page).toHaveURL(/\/apply\/status\?ref=/);
    await expect(formAlert(page)).toContainText("No application was found");
  });
});

test.describe("contact form", () => {
  test("validates, then delivers to the platform inbox", async ({ page }) => {
    await page.goto("/contact");
    await page.getByRole("button", { name: "Send message" }).click();
    await settle(page);
    await expect(page.locator("#message-error")).toBeVisible();
    await page.getByLabel("Your name").fill("Visitor Vee");
    await page.getByLabel("Email").fill("visitor.vee@example.test");
    await page.getByLabel("Message").fill("short");
    await page.getByRole("button", { name: "Send message" }).click();
    await settle(page);
    await expect(page.locator("#message-error")).toBeVisible();
    await expect(page.getByLabel("Your name")).toHaveValue("Visitor Vee");
    await page.getByLabel("Message").fill("Do you support colleges with a diploma wing as well as engineering?");
    await expect(page.getByLabel("Message")).toHaveValue(/diploma wing/);
    await page.getByRole("button", { name: "Send message" }).click();
    await expect(page.getByText("Thank you — your message was received.")).toBeVisible();
  });
});

test.describe("route protection of the console", () => {
  for (const key of ["studentX", "officerX"]) {
    test(`${key} cannot open platform pages`, async ({ page }) => {
      await loginAs(page, key);
      for (const path of ["/platform", "/platform/applications", "/platform/colleges", "/platform/inquiries", "/platform/audit"]) {
        await page.goto(path);
        await expectOnSignIn(page, "platform");                                // the platform area needs its own sign-in
      }
    });
  }
  test("anonymous visitors are sent to sign in", async ({ page }) => {
    for (const path of ["/platform/applications", "/platform/colleges", "/platform/audit", "/platform/inquiries"]) {
      await page.goto(path);
      await expectOnSignIn(page);
    }
  });
});

test.describe.serial("platform administrator console", () => {
  let admin: Page;
  let inviteLink = "";
  let collegeUrl = "";
  const newAdminPassword = "Zephyr-Admin-Passw0rd!";
  const others: Page[] = [];

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    admin = await (await browser.newContext()).newPage();
    await loginAs(admin, "platform");
  });
  test.afterAll(async () => { await admin.context().close(); for (const p of others) await p.context().close(); });

  test("navigation shows only the platform sections and the overview shows real numbers", async () => {
    await admin.goto("/platform");
    for (const n of ["Overview", "Applications", "Colleges", "Inquiries", "Audit log", "Account"]) await expect(admin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: n })).toBeVisible();
    await expect(admin.getByRole("heading", { name: "Platform overview" })).toBeVisible();
    const awaiting = Number(await admin.getByTestId("stat-Awaiting review").innerText());
    await admin.goto("/platform/applications?status=SUBMITTED");
    await expect(admin.getByTestId("page-summary")).toContainText(`of ${awaiting}`);
    expect(awaiting).toBeGreaterThanOrEqual(20); // 19 seeded + those created by the public-form tests
  });

  test("lists applications with search, status filter and pagination", async () => {
    await admin.goto("/platform/applications");
    await expect(admin.getByRole("row")).toHaveCount(16); // header + 15
    await expect(admin.getByTestId("page-summary")).toContainText("Showing 1–15 of");
    await admin.getByRole("link", { name: "Next" }).click();
    await expect(admin).toHaveURL(/page=2/);
    await expect(admin.getByTestId("page-summary")).toContainText("Showing 16–");

    await admin.goto("/platform/applications");
    await admin.getByLabel("Search applications").fill("Paginated College 07");
    await admin.getByRole("button", { name: "Search" }).click();
    await expect(admin.getByRole("row")).toHaveCount(2);
    await expect(admin.getByRole("link", { name: "Paginated College 07" })).toBeVisible();

    await admin.goto("/platform/applications?q=100%25_%5C"); // wildcards are matched literally, so nothing matches
    await expect(admin.getByText("No applications found")).toBeVisible();

    await admin.goto("/platform/applications?q=Honeypot%20Probe");
    await expect(admin.getByText("No applications found")).toBeVisible(); // the honeypot submission was never stored

    await admin.goto("/platform/applications?status=APPROVED");
    await expect(admin.getByRole("link", { name: "Paginated College 07" })).toHaveCount(0);
  });

  test("review -> approve creates the workspace and shows a one-time invitation link exactly once", async () => {
    await admin.goto("/platform/applications?q=Zephyr");
    await admin.getByRole("link", { name: "Zephyr Institute of Technology" }).click();
    await expect(admin.getByText("Submitted", { exact: true }).first()).toBeVisible();
    await expect(admin.getByRole("button", { name: "Approve and create invitation" })).toHaveCount(0); // cannot approve before review
    await admin.getByRole("button", { name: "Start review" }).click();
    await expect(admin.getByRole("button", { name: "Approve and create invitation" })).toBeVisible();
    await expect(admin.getByLabel("College administrator's email")).toHaveValue("principal@zephyr.e2e.test");
    await admin.getByLabel("College administrator's email").fill("zephyr.admin@e2e.test");
    await admin.getByRole("button", { name: "Approve and create invitation" }).click();
    const panel = admin.getByTestId("invite-link-panel");
    await expect(panel).toBeVisible();
    inviteLink = await panel.getByLabel("One-time link").inputValue();
    expect(inviteLink).toMatch(/^http:\/\/127\.0\.0\.1:3100\/accept-invite\?token=[A-Za-z0-9_-]{43}$/);
    await expect(panel).toContainText("zephyr.admin@e2e.test");

    await admin.reload();
    await expect(admin.getByTestId("invite-link-panel")).toHaveCount(0); // not recoverable
    await expect(admin.getByText("Approved", { exact: true }).first()).toBeVisible();
    await expect(admin.getByRole("button", { name: "Approve and create invitation" })).toHaveCount(0);
    await admin.getByRole("link", { name: "Open the college" }).click();
    collegeUrl = admin.url();
    await expect(admin.getByRole("heading", { name: "Zephyr Institute of Technology" })).toBeVisible();
    await expect(admin.getByText("zephyr.admin@e2e.test").first()).toBeVisible(); // pending invitation
  });

  test("the invited administrator accepts and lands in their own workspace", async ({ browser }) => {
    const ctx = await browser.newContext();
    const p = await ctx.newPage();
    others.push(p);
    await p.goto(inviteLink);
    await expect(p.getByText("Zephyr Institute of Technology")).toBeVisible();
    await expect(p.getByText("college administrator")).toBeVisible();
    await p.getByLabel("Full name").fill("Zara Zephyr");
    await p.getByLabel("Choose a password").fill(newAdminPassword);
    await p.getByLabel("Confirm password").fill(newAdminPassword);
    await p.getByRole("button", { name: "Create account" }).click();
    await expectOn(p, "/login/college\\?welcome=1");
    await p.getByLabel("Email").fill("zephyr.admin@e2e.test");
    await p.getByLabel("Password").fill(newAdminPassword);
    await p.getByRole("button", { name: "Sign in" }).click();
    await expectOn(p, "/college");
    await expect(p.getByRole("heading", { name: "College dashboard" })).toBeVisible();
    await expect(p.getByText("Zephyr Institute of Technology").first()).toBeVisible();
    await p.goto("/platform/colleges"); // not a platform user: the platform area asks for its own sign-in
    await expectOnSignIn(p, "platform");

    const reuse = await (await browser.newContext()).newPage();
    others.push(reuse);
    await reuse.goto(inviteLink);
    await expect(reuse.getByText("invalid, already used, or has expired")).toBeVisible();
  });

  test("the applicant's status page now says approved", async ({ page }) => {
    await page.goto(`/apply/status?ref=${seed().zephyrRef}`);
    await expect(page.getByText("Approved", { exact: true })).toBeVisible();
    await expect(page.getByText("Zephyr Institute of Technology")).toBeVisible();
  });

  test("directory lists the college with its administrator state", async () => {
    await admin.goto("/platform/colleges?q=Zephyr");
    const row = admin.getByRole("row", { name: /Zephyr Institute of Technology/ });
    await expect(row.getByText("Active", { exact: true })).toHaveCount(2); // access + administrator
    await expect(row).toContainText("Not started");
    await admin.goto("/platform/colleges?access=SUSPENDED");
    await expect(admin.getByRole("link", { name: "Zephyr Institute of Technology" })).toHaveCount(0);
  });

  test("rejecting needs a real reason, and the applicant can read it", async () => {
    await admin.goto("/platform/applications?q=Quartz");
    await admin.getByRole("link", { name: "Quartz College of Engineering" }).click();
    await admin.getByRole("button", { name: "Start review" }).click();
    await expect(admin.getByRole("button", { name: "Reject application" })).toBeVisible();
    await admin.getByLabel("Reason (shown to the applicant)").fill("      ");
    await admin.getByRole("button", { name: "Reject application" }).click();
    await expect(formAlert(admin)).toContainText("at least 5 characters");
    await admin.getByLabel("Reason (shown to the applicant)").fill("The institution does not offer engineering programmes.");
    await admin.getByRole("button", { name: "Reject application" }).click();
    await expect(admin.getByText("Application rejected.")).toBeVisible();
    await expect(admin.getByRole("button", { name: "Reject application" })).toHaveCount(0); // terminal

    const pub = await admin.context().browser()!.newContext();
    const p = await pub.newPage();
    await p.goto(`/apply/status?ref=${seed().quartzRef}`);
    await expect(p.getByText("Rejected", { exact: true })).toBeVisible();
    await expect(p.getByText("The institution does not offer engineering programmes.")).toBeVisible();
    await pub.close();
  });

  test("commercial status is recorded manually and is filterable; it does not block access", async () => {
    await admin.goto(collegeUrl);
    await admin.getByLabel("Commercial status").selectOption("PENDING");
    await admin.getByLabel("Internal note (not visible to the college)").fill("Pilot agreement sent");
    await admin.getByRole("button", { name: "Save commercial status" }).click();
    await expect(admin.getByText("Commercial status recorded.")).toBeVisible();
    await admin.reload();
    await expect(admin.getByLabel("Internal note (not visible to the college)")).toHaveValue("Pilot agreement sent");
    await admin.goto("/platform/colleges?commercial=PENDING");
    await expect(admin.getByRole("link", { name: "Zephyr Institute of Technology" })).toBeVisible();
    const p = others[0];
    await p.goto("/college");
    await expectOn(p, "/college"); // the administrator still has access
  });

  test("suspending cuts off the college at once; reactivating restores it", async ({ browser }) => {
    const p = others[0]; // the college admin's live session
    await admin.goto(collegeUrl);
    await admin.getByLabel("Reason for suspension").fill("     ");
    await admin.getByRole("button", { name: "Suspend college" }).click();
    await expect(formAlert(admin)).toContainText("at least 5 characters");
    await admin.getByLabel("Reason for suspension").fill("Agreement not signed within the pilot window");
    await admin.getByRole("button", { name: "Suspend college" }).click();
    await expect(admin.getByText("College suspended.")).toBeVisible();
    await expect(admin.getByText("Agreement not signed within the pilot window")).toBeVisible();

    await p.goto("/college");
    await expectOnSignIn(p); // existing session is dead
    await p.goto("/login/college");
    await p.getByLabel("Email").fill("zephyr.admin@e2e.test");
    await p.getByLabel("Password").fill(newAdminPassword);
    await p.getByRole("button", { name: "Sign in" }).click();
    await expect(formAlert(p)).toHaveText("Invalid email or password."); // no hint that the college is suspended

    await admin.goto("/platform/colleges?access=SUSPENDED");
    await expect(admin.getByRole("link", { name: "Zephyr Institute of Technology" })).toBeVisible();
    await admin.goto(collegeUrl);
    await expect(admin.getByText("Reactivate the college before inviting administrators.")).toBeVisible();
    await admin.getByRole("button", { name: "Reactivate college" }).click();
    await expect(admin.getByText("College reactivated.")).toBeVisible();

    await p.getByLabel("Email").fill("zephyr.admin@e2e.test");
    await p.getByLabel("Password").fill(newAdminPassword);
    await p.getByRole("button", { name: "Sign in" }).click();
    await expectOn(p, "/college");
    void browser;
  });

  test("a new administrator invitation can be issued and invalidates the previous one", async ({ browser }) => {
    await admin.goto(collegeUrl);
    await admin.getByLabel("Administrator's email").fill("second.admin@e2e.test");
    await admin.getByRole("button", { name: "Create one-time invitation" }).click();
    const first = await admin.getByTestId("invite-link-panel").getByLabel("One-time link").inputValue();
    await admin.getByRole("button", { name: "Create one-time invitation" }).click();
    await expect(admin.getByTestId("invite-link-panel").getByLabel("One-time link")).not.toHaveValue(first); // waits for the new link
    const second = await admin.getByTestId("invite-link-panel").getByLabel("One-time link").inputValue();
    const ctx = await browser.newContext(); const p = await ctx.newPage();
    await p.goto(first);
    await expect(p.getByText("invalid, already used, or has expired")).toBeVisible();
    await p.goto(second);
    await expect(p.getByRole("button", { name: "Create account" })).toBeVisible();
    await ctx.close();
  });

  test("inquiries from the contact form arrive and can be marked handled", async () => {
    await admin.goto("/platform/inquiries?status=NEW");
    const item = admin.getByRole("listitem").filter({ hasText: "Visitor Vee" });
    await expect(item).toContainText("diploma wing");
    await item.getByRole("button", { name: "Mark handled" }).click();
    // Wait for the save to finish before navigating away: the page refreshes and the item leaves the "New" list.
    // (Waiting for the button alone raced: it turns into "Saving…" at once, before the save is stored.)
    await expect(item).toHaveCount(0);
    await admin.goto("/platform/inquiries?status=HANDLED");
    await expect(admin.getByRole("listitem").filter({ hasText: "Visitor Vee" })).toContainText("Handled");
    await admin.goto("/platform/inquiries?status=NEW");
    await expect(admin.getByRole("listitem").filter({ hasText: "Visitor Vee" })).toHaveCount(0);
  });

  test("the audit log records the actions above and can be filtered", async () => {
    await admin.goto("/platform/audit");
    await expect(admin.getByRole("row", { name: /Application approved/ }).first()).toBeVisible();
    await expect(admin.getByRole("row", { name: /College suspended/ }).first()).toBeVisible();
    await admin.getByLabel("Action").selectOption("COLLEGE_REACTIVATED");
    await admin.getByRole("button", { name: "Filter" }).click();
    await expect(admin.getByRole("row", { name: /College reactivated/ })).toHaveCount(1);
    await expect(admin.getByRole("row", { name: /Application approved/ })).toHaveCount(0);
    await expect(admin.getByRole("row", { name: /Application rejected/ })).toHaveCount(0);
  });

  test("hostile text in an application is shown as text, never executed", async ({ browser }) => {
    const evil = `<img src=x onerror="window.__xss=1"><script>window.__xss=2</script> ${unique()}`;
    const ctx = await browser.newContext(); const pub = await ctx.newPage();
    await fillApplication(pub, { name: evil, contactPerson: `<b onmouseover="window.__xss=3">x</b> Person` });
    await submit(pub);
    await expect(pub).toHaveURL(/status/);
    expect(await pub.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    await ctx.close();

    let dialog = false;
    admin.on("dialog", (d) => { dialog = true; void d.dismiss(); });
    await admin.goto("/platform/applications?status=SUBMITTED&q=onerror");
    await expect(admin.getByText(evil.split(" ").slice(0, 3).join(" ")).first()).toBeVisible();
    await admin.getByRole("row").nth(1).getByRole("link").click();
    await expect(admin.getByText(`<b onmouseover="window.__xss=3">x</b> Person`)).toBeVisible();
    expect(await admin.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
    expect(dialog).toBe(false);
  });

  test("an unknown or malformed id is a 404, not an error page", async () => {
    for (const path of ["/platform/applications/not-a-uuid", "/platform/applications/00000000-0000-4000-8000-000000000000", "/platform/colleges/zzz", "/platform/colleges/00000000-0000-4000-8000-000000000000"]) {
      const res = await admin.goto(path);
      expect(res?.status(), path).toBe(404);
    }
  });
});

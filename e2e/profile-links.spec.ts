import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { inspect } from "../db/tests/world";
import { loginAs, seed } from "./helpers";

const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

test.describe.serial("student coding profiles", () => {
  let student: Page; let coord: Page;
  const open: Page[] = [];
  const newPage = async (b: Browser, who: string) => { const p = await (await b.newContext()).newPage(); open.push(p); await loginAs(p, who); return p; };
  test.beforeAll(async ({ browser }) => { student = await newPage(browser, "profA"); coord = await newPage(browser, "regCoord"); });
  test.afterAll(async () => { for (const p of open) await p.context().close(); });

  test("the student saves GitHub, LeetCode and LinkedIn links; wrong addresses are refused with a clear message", async () => {
    await student.goto("/student/profile");
    await expect(student.getByRole("heading", { name: "Coding & professional profiles" })).toBeVisible();
    await student.getByLabel("GitHub profile").fill("https://evil.example/octo");
    await student.getByRole("button", { name: "Save profile links" }).click();
    await expect(student.getByText("Enter the full GitHub profile address")).toBeVisible();
    await student.getByLabel("GitHub profile").fill("https://github.com/octo-prof");
    await student.getByLabel("LeetCode profile").fill("https://leetcode.com/u/octo-prof");
    await student.getByLabel("LinkedIn profile").fill("https://www.linkedin.com/in/octo-prof");
    await student.getByRole("button", { name: "Save profile links" }).click();
    await expect(student.getByText("Profile links saved.")).toBeVisible();
    await student.reload();
    await expect(student.getByLabel("GitHub profile")).toHaveValue("https://github.com/octo-prof");
    const a11y = await new AxeBuilder({ page: student }).withTags(TAGS).analyze(); expect(a11y.violations.map((v) => v.id)).toEqual([]);
  });

  test("the department's coordinator sees the links on the student's page, as safe external links", async () => {
    const [st] = await inspect<{ id: string }>("SELECT id FROM students WHERE college_email = $1", [seed().users.profA]);
    await coord.goto(`/coordinator/students/${st.id}`);
    const gh = coord.getByRole("link", { name: "GitHub" });
    await expect(gh).toHaveAttribute("href", "https://github.com/octo-prof");
    await expect(gh).toHaveAttribute("rel", /noopener/);
    await expect(gh).toHaveAttribute("target", "_blank");
    await expect(coord.getByRole("link", { name: "LeetCode" })).toBeVisible(); await expect(coord.getByRole("link", { name: "LinkedIn" })).toBeVisible();
  });

  test("clearing the boxes removes the links", async () => {
    await student.goto("/student/profile");
    for (const l of ["GitHub profile", "LeetCode profile", "LinkedIn profile"]) await student.getByLabel(l).fill("");
    await student.getByRole("button", { name: "Save profile links" }).click();
    await expect(student.getByText("Profile links saved.")).toBeVisible();
    const [st] = await inspect<{ github_url: string | null }>("SELECT github_url FROM students WHERE college_email = $1", [seed().users.profA]);
    expect(st.github_url).toBeNull();
  });
});

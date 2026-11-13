import { describe, expect, it } from "vitest";
import { collegeApplicationSchema, collegeProfileSchema, departmentSchema, httpUrl, inquirySchema, likePattern, reasonSchema, safeHref, staffInviteSchema } from "./validation";

const valid = {
  name: "Example Institute of Technology", officialEmail: "Principal@Example.EDU ", address: "1 College Road, Town",
  state: "Tamil Nadu", district: "Chennai", website: "https://example.edu", contactPerson: "Dr A. Person",
  phone: "+91 98765 43210", collegeType: "PRIVATE", approxStudents: "1500",
};

describe("college application validation", () => {
  it("accepts a valid application and normalises the email", () => {
    const r = collegeApplicationSchema.parse(valid);
    expect(r.officialEmail).toBe("principal@example.edu");
    expect(r.approxStudents).toBe(1500);
  });
  it.each([
    ["javascript: URL", { website: "javascript:alert(1)" }],
    ["data: URL", { website: "data:text/html,<script>1</script>" }],
    ["ftp URL", { website: "ftp://example.edu" }],
    ["no scheme", { website: "example.edu" }],
    ["unknown state", { state: "Atlantis" }],
    ["unknown college type", { collegeType: "SPACESHIP" }],
    ["bad phone", { phone: "abc" }],
    ["bad email", { officialEmail: "nope" }],
    ["tiny strength", { approxStudents: "3" }],
    ["fractional strength", { approxStudents: "12.5" }],
    ["non-numeric strength", { approxStudents: "lots" }],
    ["empty name", { name: "   " }],
  ])("rejects %s", (_l, over) => {
    expect(collegeApplicationSchema.safeParse({ ...valid, ...over }).success).toBe(false);
  });
});

describe("helpers", () => {
  it("httpUrl only allows http(s)", () => {
    expect(httpUrl.safeParse("http://a.test").success).toBe(true);
    expect(httpUrl.safeParse("https://a.test/path?q=1").success).toBe(true);
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "vbscript:x", "file:///etc/passwd", "//evil.test", "https://a.test/ x"]) expect(httpUrl.safeParse(bad).success).toBe(false);
  });
  it("safeHref refuses non-http(s) values", () => {
    expect(safeHref("https://a.test")).toBe("https://a.test/");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref("not a url")).toBeNull();
  });
  it("likePattern escapes wildcards", () => {
    expect(likePattern("100%_done\\")).toBe("%100\\%\\_done\\\\%");
  });
  it("reason and inquiry limits", () => {
    expect(reasonSchema.safeParse("no").success).toBe(false);
    expect(reasonSchema.safeParse("a good reason").success).toBe(true);
    expect(inquirySchema.safeParse({ name: "Al", email: "a@b.test", message: "too short" }).success).toBe(false);
    expect(inquirySchema.safeParse({ name: "Al", email: "a@b.test", message: "long enough message" }).success).toBe(true);
  });
});

describe("department and staff validation", () => {
  it("normalises department codes and rejects bad ones", () => {
    expect(departmentSchema.parse({ name: "Computer Science", code: " cse-2 " }).code).toBe("CSE-2");
    for (const code of ["a", "-BAD", "HAS SPACE", "WAYTOOLONGCODE1", "<b>", ""]) expect(departmentSchema.safeParse({ name: "Valid", code }).success, code).toBe(false);
    expect(departmentSchema.safeParse({ name: "X", code: "CSE" }).success).toBe(false);
    expect(departmentSchema.safeParse({ name: "Valid", code: "CSE", description: "x".repeat(501) }).success).toBe(false);
  });
  it("staff invitations allow only officer and coordinator roles", () => {
    expect(staffInviteSchema.safeParse({ email: "a@b.test", role: "PLACEMENT_OFFICER" }).success).toBe(true);
    for (const role of ["COLLEGE_ADMIN", "PLATFORM_SUPER_ADMIN", "STUDENT", "", "root"]) expect(staffInviteSchema.safeParse({ email: "a@b.test", role }).success, role).toBe(false);
  });
  it("profile requires a web address and a known state", () => {
    const ok = { address: "1 Road, Town", district: "Salem", state: "Tamil Nadu", website: "https://x.test", contactPerson: "Dr X", phone: "9876543210", approxStudents: "500" };
    expect(collegeProfileSchema.safeParse(ok).success).toBe(true);
    expect(collegeProfileSchema.safeParse({ ...ok, website: "javascript:1" }).success).toBe(false);
    expect(collegeProfileSchema.safeParse({ ...ok, state: "Narnia" }).success).toBe(false);
  });
});

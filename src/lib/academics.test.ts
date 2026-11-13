import { describe, expect, it } from "vitest";
import { academicFormSchema, fmtCgpa, fmtPct } from "./academics";

const ok = { cgpa: "8.25", tenth: "90.5", twelfth: "88", diploma: "", backlogs: "0", arrears: "1", note: "" };

describe("academicFormSchema", () => {
  it("parses a valid submission; blank optional fields are undefined, not zero", () => {
    const r = academicFormSchema.parse(ok);
    expect(r).toMatchObject({ cgpa: 8.25, tenth: 90.5, twelfth: 88, backlogs: 0, arrears: 1 });
    expect(r.diploma).toBeUndefined();
    expect(r.note).toBeUndefined();
  });
  it("accepts the diploma route (no 12th)", () => {
    const r = academicFormSchema.parse({ ...ok, twelfth: "", diploma: "77.5" });
    expect(r.twelfth).toBeUndefined();
    expect(r.diploma).toBe(77.5);
  });
  it("requires either the 12th or the diploma percentage", () => {
    const r = academicFormSchema.safeParse({ ...ok, twelfth: "", diploma: "" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toMatch(/12th percentage or your diploma/);
  });
  it("requires the counts to be typed: a blank backlog/arrear field is an error, never a silent 0", () => {
    expect(academicFormSchema.safeParse({ ...ok, backlogs: "" }).success).toBe(false);
    expect(academicFormSchema.safeParse({ ...ok, arrears: "" }).success).toBe(false);
    expect(academicFormSchema.safeParse({ ...ok, backlogs: "0", arrears: "0" }).success).toBe(true);
  });
  it("requires CGPA and the 10th percentage", () => {
    expect(academicFormSchema.safeParse({ ...ok, cgpa: "" }).success).toBe(false);
    expect(academicFormSchema.safeParse({ ...ok, tenth: "" }).success).toBe(false);
  });
  it.each([
    ["CGPA above 10", { cgpa: "10.01" }], ["CGPA with 3 decimals", { cgpa: "8.255" }], ["negative CGPA", { cgpa: "-1" }], ["scientific notation", { cgpa: "1e1" }], ["comma decimal", { cgpa: "8,5" }],
    ["text", { tenth: "ninety" }], ["10th above 100", { tenth: "100.5" }], ["12th above 100", { twelfth: "101" }], ["diploma above 100", { twelfth: "", diploma: "120" }],
    ["fractional backlogs", { backlogs: "1.5" }], ["negative backlogs", { backlogs: "-1" }], ["backlogs above 50", { backlogs: "51" }], ["arrears above 200", { arrears: "201" }],
    ["long note", { note: "x".repeat(501) }],
  ])("rejects %s", (_l, over) => { expect(academicFormSchema.safeParse({ ...ok, ...over }).success).toBe(false); });
  it("accepts the boundary values", () => {
    expect(academicFormSchema.safeParse({ ...ok, cgpa: "0", tenth: "100", twelfth: "0", backlogs: "50", arrears: "200" }).success).toBe(true);
    expect(academicFormSchema.safeParse({ ...ok, cgpa: "10" }).success).toBe(true);
  });
});

describe("formatting", () => {
  it("shows missing marks as 'Not provided', never as 0", () => {
    expect(fmtPct(null)).toBe("Not provided");
    expect(fmtPct("0")).toBe("0.00%");
    expect(fmtPct("88")).toBe("88.00%");
    expect(fmtCgpa("8.2")).toBe("8.20");
  });
});

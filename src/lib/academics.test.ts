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

import { cgpaGapNote, parseSemesters } from "./academics";
describe("semester results", () => {
  const get = (m: Record<string, string>) => (k: string) => m[k] ?? "";
  it("keeps typed semesters only; blank backlogs means 0 but a blank SGPA is never zero", () => {
    const r = parseSemesters(get({ sem1_sgpa: "8.5", sem2_sgpa: "7", sem2_backlogs: "1" }));
    expect(r.errors).toEqual({});
    expect(r.rows).toEqual([{ semester: 1, sgpa: 8.5, backlogs: 0 }, { semester: 2, sgpa: 7, backlogs: 1 }]);
    expect(parseSemesters(get({})).rows).toEqual([]);
  });
  it("refuses backlogs without an SGPA, rounding, and out-of-range values", () => {
    expect(Object.keys(parseSemesters(get({ sem3_backlogs: "1" })).errors)).toEqual(["sem3_sgpa"]);
    for (const bad of ["8.255", "10.5", "-1", "1e1", "abc"]) expect(Object.keys(parseSemesters(get({ sem1_sgpa: bad })).errors), bad).toEqual(["sem1_sgpa"]);
    expect(Object.keys(parseSemesters(get({ sem1_sgpa: "8", sem1_backlogs: "21" })).errors)).toEqual(["sem1_backlogs"]);
  });
  it("warns only when the CGPA is far from the SGPA average", () => {
    expect(cgpaGapNote("8.00", [{ sgpa: "8.3" }, { sgpa: "7.9" }])).toBeNull();
    expect(cgpaGapNote("9.50", [{ sgpa: "7" }, { sgpa: "7.5" }])).toMatch(/differs/);
    expect(cgpaGapNote("9.50", [])).toBeNull();
  });
});

import { academicChanges } from "./academics";
describe("academicChanges", () => {
  const v = { cgpa: "8.25", tenth_percentage: "90.50", twelfth_percentage: "88.00", diploma_percentage: null, active_backlogs: 0, historical_arrears: 1, semesters: [] as { semester: number; sgpa: string; backlogs: number }[] };
  it("lists only the changed values, formatted the way the review page shows them", () => {
    expect(academicChanges(v, { ...v })).toEqual([]);
    expect(academicChanges(v, { ...v, cgpa: "8.30", active_backlogs: 2 })).toEqual([
      { label: "CGPA", before: "8.25", after: "8.30" }, { label: "Active backlogs", before: "0", after: "2" },
    ]);
  });
  it("treats a missing value as 'Not provided', never 0, and reports semester changes", () => {
    expect(academicChanges(v, { ...v, twelfth_percentage: null })).toEqual([{ label: "12th percentage", before: "88.00%", after: "Not provided" }]);
    expect(academicChanges(v, { ...v, semesters: [{ semester: 1, sgpa: "8", backlogs: 1 }] })).toEqual([{ label: "Semester results", before: "None", after: "S1: 8.00 (1 backlog)" }]);
  });
});

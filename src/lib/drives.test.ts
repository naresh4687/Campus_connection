import { describe, expect, it } from "vitest";
import { criteriaLines, driveFormSchema, isoToIstInput, istToIso, yearOptions } from "./drives";

const ok = { companyId: "3f2b8c1e-5d4a-4e7b-9c1a-0b2d3e4f5a6b", title: "Software Engineer", type: "FULL_TIME", departments: [], years: [], degrees: [] };

describe("driveFormSchema", () => {
  it("only company, title and type are required for a draft; blanks are undefined, never zero", () => {
    const r = driveFormSchema.parse({ ...ok, ctc: "", openings: "", deadline: "", minCgpa: "", maxBacklogs: "" });
    expect(r.ctc).toBeUndefined(); expect(r.openings).toBeUndefined(); expect(r.minCgpa).toBeUndefined(); expect(r.maxBacklogs).toBeUndefined();
  });
  it("accepts criteria including an explicit zero (0 backlogs is a real limit)", () => {
    const r = driveFormSchema.parse({ ...ok, minCgpa: "7.5", maxBacklogs: "0", maxArrears: "2", minTenth: "60", years: ["2026"], degrees: ["B.E."] });
    expect(r).toMatchObject({ minCgpa: 7.5, maxBacklogs: 0, maxArrears: 2, minTenth: 60, years: [2026], degrees: ["B.E."] });
  });
  it.each([
    ["no title", { title: " " }], ["bad type", { type: "VOLUNTEER" }], ["CGPA above 10", { minCgpa: "10.5" }], ["3 decimals", { minCgpa: "7.555" }], ["negative", { minTenth: "-1" }], ["percentage above 100", { minTwelfth: "101" }],
    ["fractional backlogs", { maxBacklogs: "1.5" }], ["zero openings", { openings: "0" }], ["bad deadline", { deadline: "tomorrow" }], ["unknown degree", { degrees: ["PhD"] }], ["bad company id", { companyId: "x" }], ["CTC above 1000", { ctc: "1001" }],
  ])("rejects %s", (_l, over) => { expect(driveFormSchema.safeParse({ ...ok, ...over }).success).toBe(false); });
});

describe("deadline handling (IST)", () => {
  it("interprets a typed local time as Indian Standard Time and round-trips", () => {
    expect(istToIso("2026-12-01T17:00")).toBe("2026-12-01T11:30:00.000Z");
    expect(isoToIstInput("2026-12-01T11:30:00.000Z")).toBe("2026-12-01T17:00");
    expect(istToIso("2026-02-30T10:00")).toBeNull();
    expect(istToIso("garbage")).toBeNull();
  });
});

describe("criteriaLines", () => {
  const base = { min_cgpa: null, min_tenth: null, min_twelfth: null, min_diploma: null, max_active_backlogs: null, max_historical_arrears: null, passing_years: [], degrees: [] };
  it("lists only the criteria that are set; unset ones are not shown as zero", () => { expect(criteriaLines(base)).toEqual([]); });
  it("renders thresholds, limits (including 0), years and degrees", () => {
    expect(criteriaLines({ ...base, min_cgpa: "7.50", max_active_backlogs: 0, max_historical_arrears: 1, passing_years: [2026, 2027], degrees: ["B.E."] }))
      .toEqual(["CGPA of at least 7.50", "At most 0 active backlogs", "At most 1 historical arrear", "Passing year: 2026, 2027", "Degree: B.E."]);
  });
  it("yearOptions spans last year to four years ahead", () => { expect(yearOptions(new Date("2026-06-01"))).toEqual([2025, 2026, 2027, 2028, 2029, 2030]); });
});

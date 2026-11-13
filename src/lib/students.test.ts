import { describe, expect, it } from "vitest";
import { CsvError, csvCell, parseCsv, toCsv } from "./csv";
import { autoMap, buildDeptLookup, emptyMapping, mappingProblem, normalizeDegree, studentFormSchema, validateRows, type ImportContext, type Mapping } from "./students";

const enc = (s: string) => new TextEncoder().encode(s);
const depts = buildDeptLookup([{ id: "d1", code: "CSE", name: "Computer Science and Engineering", status: "ACTIVE" }, { id: "d2", code: "OLD", name: "Old Dept", status: "INACTIVE" }]);
const ctx = (over: Partial<ImportContext> = {}): ImportContext => ({ depts, existingRegisters: new Set(), existingEmails: new Set(), ...over });
const mapping: Mapping = { register_number: 0, full_name: 1, college_email: 2, personal_email: 3, phone: 4, department: 5, degree: 6, specialization: 7, admission_year: 8, passing_year: 9 };
const good = ["CS2201", "Asha Rao", "Asha@College.edu", "", "9876543210", "cse", "BE", "AI", "2022", "2026"];

describe("csvCell (formula injection)", () => {
  it.each([["=1+1", "'=1+1"], ["+cmd|' /C calc'!A0", "'+cmd|' /C calc'!A0"], ["-2+3", "'-2+3"], ["@SUM(A1)", "'@SUM(A1)"], ["\tTAB", "'\tTAB"], ["\rCR", "\"'\rCR\""]])("neutralises %j", (input, expected) => {
    expect(csvCell(input)).toBe(expected);
  });
  it("leaves ordinary values alone and quotes when needed", () => {
    expect(csvCell("Asha Rao")).toBe("Asha Rao");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(csvCell(null)).toBe("");
    expect(csvCell(42)).toBe("42");
  });
  it("neutralises dangerous values inside quoted cells too", () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
  });
  it("toCsv joins rows with CRLF", () => { expect(toCsv([["a", "=b"], [1, 2]])).toBe("a,'=b\r\n1,2\r\n"); });
});

describe("parseCsv", () => {
  it("parses headers and rows, strips a BOM, pads short rows, ignores blank lines", () => {
    const r = parseCsv(enc("﻿Name,Email,Dept\nAsha,a@x.test,CSE\n\nRavi,r@x.test\n"));
    expect(r.headers).toEqual(["Name", "Email", "Dept"]);
    expect(r.rows).toEqual([["Asha", "a@x.test", "CSE"], ["Ravi", "r@x.test", ""]]);
  });
  it("handles quoted commas/newlines and semicolon- or tab-separated files", () => {
    expect(parseCsv(enc('a,b\n"x, y","line1\nline2"\n')).rows).toEqual([["x, y", "line1\nline2"]]);
    expect(parseCsv(enc("a;b\n1;2\n")).rows).toEqual([["1", "2"]]);
    expect(parseCsv(enc("a\tb\n1\t2\n")).rows).toEqual([["1", "2"]]);
  });
  it.each([
    ["empty", ""], ["header only", "a,b\n"], ["binary", "a,b\n1,\u0000\n"], ["invalid UTF-8", null],
    ["too many columns", Array.from({ length: 31 }, (_, i) => `c${i}`).join(",") + "\n" + Array.from({ length: 31 }, () => "1").join(",")],
    ["row wider than header", "a,b\n1,2,3\n"], ["huge cell", "a\n" + "x".repeat(501)],
  ])("rejects %s with a readable message", (_l, content) => {
    const buf = content === null ? new Uint8Array([0xff, 0xfe, 0xfd, 0x41]) : enc(content);
    expect(() => parseCsv(buf)).toThrow(CsvError);
  });
  it("rejects oversized files and too many rows", () => {
    expect(() => parseCsv(new Uint8Array(2 * 1024 * 1024 + 1))).toThrow(/larger/);
    expect(() => parseCsv(enc("a\n" + Array.from({ length: 5001 }, (_, i) => `r${i}`).join("\n")))).toThrow(/5000/);
    expect(parseCsv(enc("a\n" + Array.from({ length: 5000 }, (_, i) => `r${i}`).join("\n"))).rows).toHaveLength(5000);
  });
  it("keeps formula-looking cells as plain text (nothing is evaluated on import)", () => {
    expect(parseCsv(enc("a\n=1+1\n")).rows).toEqual([["=1+1"]]);
  });
});

describe("degree normalisation", () => {
  it.each([["BE", "B.E."], ["b.e.", "B.E."], ["B.E", "B.E."], ["Bachelor of Engineering", "B.E."], ["btech", "B.Tech"], ["B. Tech", "B.Tech"], ["M.Tech", "M.Tech"], ["mca", "MCA"], ["MBA", "MBA"], ["B.Sc", "B.Sc"], ["diploma", "Diploma"]])("%s -> %s", (i, o) => {
    expect(normalizeDegree(i)).toBe(o);
  });
  it("returns null for unknown or empty values", () => { expect(normalizeDegree("Wizardry")).toBeNull(); expect(normalizeDegree("")).toBeNull(); });
});

describe("header auto-mapping", () => {
  it("maps common header names and never uses a column twice", () => {
    const m = autoMap(["Reg No", "Student Name", "Email", "Mobile", "Branch", "Course", "Year of Admission", "Year of Passing", "Extra"]);
    expect(m).toMatchObject({ register_number: 0, full_name: 1, college_email: 2, phone: 3, department: 4, degree: 5, admission_year: 6, passing_year: 7, personal_email: null, specialization: null });
  });
  it("reports missing required fields, duplicate and out-of-range columns", () => {
    expect(mappingProblem(emptyMapping(), 5)).toMatch(/Register number/);
    expect(mappingProblem({ ...mapping, full_name: 0 }, 10)).toMatch(/same column/);
    expect(mappingProblem({ ...mapping, phone: 99 }, 10)).toMatch(/does not exist/);
    expect(mappingProblem(mapping, 10)).toBeNull();
    expect(mappingProblem({ ...mapping, personal_email: null, phone: null, specialization: null }, 10)).toBeNull();
  });
});

describe("validateRows", () => {
  it("accepts a good row and normalises it", () => {
    const [r] = validateRows([good], mapping, ctx());
    expect(r.status).toBe("VALID");
    expect(r.normalized).toMatchObject({ register_number: "CS2201", college_email: "asha@college.edu", degree: "B.E.", department_id: "d1", admission_year: 2022, passing_year: 2026, personal_email: null, specialization: "AI" });
  });
  it("matches departments by code or name, case-insensitively; rejects unknown and inactive ones", () => {
    const run = (dept: string) => validateRows([[...good.slice(0, 5), dept, ...good.slice(6)]], mapping, ctx())[0];
    expect(run("CSE").status).toBe("VALID");
    expect(run("computer science and engineering").normalized?.department_id).toBe("d1");
    expect(run("MECH").errors.join()).toMatch(/does not exist/);
    expect(run("OLD").errors.join()).toMatch(/inactive/);
    expect(run("").errors.join()).toMatch(/missing/);
  });
  it.each([
    ["short register number", 0, "A1"], ["register number with spaces", 0, "AB 12"], ["one-letter name", 1, "X"], ["bad email", 2, "nope"], ["bad personal email", 3, "no"], ["bad phone", 4, "abc"],
    ["unknown degree", 6, "Wizard"], ["text year", 8, "twenty"], ["3-digit year", 9, "202"],
  ])("flags %s", (_l, col, value) => {
    const row = [...good]; row[col] = value;
    const [r] = validateRows([row], mapping, ctx());
    expect(r.status).toBe("ERROR");
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.normalized).toBeNull();
  });
  it("checks the year order and the 8-year limit", () => {
    const y = (a: string, p: string) => { const row = [...good]; row[8] = a; row[9] = p; return validateRows([row], mapping, ctx())[0]; };
    expect(y("2022", "2026").status).toBe("VALID");
    expect(y("2022", "2022").status).toBe("ERROR");
    expect(y("2026", "2022").status).toBe("ERROR");
    expect(y("2010", "2025").status).toBe("ERROR");
  });
  it("flags empty rows", () => {
    expect(validateRows([["", "", "", "", "", "", "", "", "", ""]], mapping, ctx())[0].errors).toEqual(["The row is empty."]);
  });
  it("marks in-file duplicates (the first occurrence stays valid) and reports the original row", () => {
    const other = [...good]; other[0] = "CS9999";                       // same email, different register number
    const sameReg = [...good]; sameReg[2] = "different@college.edu";   // same register number, different email
    const r = validateRows([good, other, sameReg, good], mapping, ctx());
    expect(r.map((x) => x.status)).toEqual(["VALID", "DUPLICATE", "DUPLICATE", "DUPLICATE"]);
    expect(r[1].errors[0]).toMatch(/row 2/);   // spreadsheet numbering: the header is row 1, the first data row is row 2
    expect(r[3].errors[0]).toMatch(/row 2/);
  });
  it("marks rows that match existing students as duplicates and says existing records are not changed", () => {
    const r = validateRows([good], mapping, ctx({ existingRegisters: new Set(["cs2201"]) }))[0];
    expect(r.status).toBe("DUPLICATE");
    expect(r.errors[0]).toMatch(/never changed/);
    expect(validateRows([good], mapping, ctx({ existingEmails: new Set(["asha@college.edu"]) }))[0].errors[0]).toMatch(/college email/);
  });
  it("treats register numbers case-insensitively for duplicates", () => {
    const lower = [...good]; lower[0] = "cs2201"; lower[2] = "other@college.edu";
    expect(validateRows([good, lower], mapping, ctx()).map((x) => x.status)).toEqual(["VALID", "DUPLICATE"]);
  });
  it("never lets markup or formulas through as 'valid' identity fields", () => {
    const row = [...good]; row[0] = "<script>1"; expect(validateRows([row], mapping, ctx())[0].status).toBe("ERROR");
    const row2 = [...good]; row2[1] = "Bad\u0007Name"; expect(validateRows([row2], mapping, ctx())[0].status).toBe("ERROR");
  });
});

describe("single-student form schema", () => {
  const ok = { departmentId: "3f2b8c1e-5d4a-4e7b-9c1a-0b2d3e4f5a6b", registerNumber: "CS2201", fullName: "Asha Rao", collegeEmail: "A@B.test", degree: "B.E.", admissionYear: "2022", passingYear: "2026" };
  it("accepts a valid student and lower-cases the email; optional fields may be blank", () => {
    const r = studentFormSchema.parse({ ...ok, personalEmail: "", phone: "", specialization: "" });
    expect(r.collegeEmail).toBe("a@b.test");
    expect(r.personalEmail).toBeUndefined();
  });
  it("rejects bad values", () => {
    for (const over of [{ degree: "PhD" }, { passingYear: "2020" }, { registerNumber: "x" }, { collegeEmail: "no" }, { departmentId: "not-a-uuid" }, { phone: "abc" }]) expect(studentFormSchema.safeParse({ ...ok, ...over }).success, JSON.stringify(over)).toBe(false);
  });
});

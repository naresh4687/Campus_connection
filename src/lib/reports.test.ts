import { describe, expect, it } from "vitest";
import { csvCell } from "./csv";
import { pct, pctText, reportCsv, type PlacedRow } from "./reports";

describe("csvCell neutralises spreadsheet formulas", () => {
  it.each(["=1+1", "+SUM(A1)", "-2+3", "@cmd", "\t=1", "\r=1", "=HYPERLINK(\"http://evil\",\"x\")", "=cmd|' /C calc'!A0"])("prefixes %j with a quote", (v) => {
    const out = csvCell(v);
    expect(out.replace(/^"/, "").startsWith("'")).toBe(true);
  });
  it("leaves ordinary text and numbers alone, quotes commas/quotes/newlines, and handles empty values", () => {
    expect(csvCell("Asha Rao")).toBe("Asha Rao"); expect(csvCell(42)).toBe("42"); expect(csvCell(null)).toBe(""); expect(csvCell(undefined)).toBe("");
    expect(csvCell("a,b")).toBe('"a,b"'); expect(csvCell('say "hi"')).toBe('"say ""hi"""'); expect(csvCell("line1\nline2")).toBe('"line1\nline2"');
  });
});

describe("percentages", () => {
  it("never divide by zero and round to one decimal", () => {
    expect(pct(1, 0)).toBeNull(); expect(pctText(0, 0)).toBe("—"); expect(pct(1, 3)).toBe(33.3); expect(pct(2, 3)).toBe(66.7); expect(pct(5, 5)).toBe(100); expect(pctText(0, 4)).toBe("0%");
  });
});

describe("report CSV", () => {
  const placed = (over: Partial<PlacedRow> = {}): PlacedRow => ({ full_name: "Asha Rao", register_number: "R1", department_code: "CSE", degree: "B.E.", passing_year: 2026, company_name: "Acme, Inc.", job_title: "Engineer", ctc_lpa: "6.50", joined_on: "2026-07-01", ...over });
  it("starts with a BOM and a header, uses CRLF, and quotes awkward values", () => {
    const csv = reportCsv("placed", [placed()]);
    expect(csv.startsWith("﻿Name,Register number,Department,Degree,Passing year,Company,Job title,CTC (LPA),Joined on\r\n")).toBe(true);
    expect(csv).toContain('"Acme, Inc."'); expect(csv.endsWith("\r\n")).toBe(true);
  });
  it("neutralises hostile names and company titles in every report type", () => {
    const evil = "=cmd|' /C calc'!A0";
    for (const [type, rows] of [["placed", [placed({ full_name: evil, company_name: "+1", job_title: "@x" })]],
      ["drives", [{ drive_id: "x", job_title: evil, company_name: "-1", status: "CLOSED", registered: 1, selected: 1, offers_issued: 1, accepted: 1, placed: 1 }]],
      ["companies", [{ company_id: "x", company_name: evil, drives: 1, selected: 1, accepted: 1, placed: 1 }]],
      ["departments", [{ code: "=A1", name: evil, students: 2, registered_students: 1, selected_students: 1, accepted_students: 1, placed_students: 1 }]]] as const) {
      const lines = reportCsv(type, [...rows]).split("\r\n").slice(1, 2)[0];
      for (const cell of lines.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []) {
        const c = cell.replace(/,$/, "").replace(/^"/, "");
        expect(/^[=+\-@\t\r]/.test(c), `${type}: ${c}`).toBe(false);
      }
    }
  });
  it("shows the placement rate, and leaves it empty for a department with no students", () => {
    const csv = reportCsv("departments", [{ code: "CSE", name: "CS", students: 4, registered_students: 3, selected_students: 2, accepted_students: 1, placed_students: 1 }, { code: "ECE", name: "EC", students: 0, registered_students: 0, selected_students: 0, accepted_students: 0, placed_students: 0 }]).split("\r\n");
    expect(csv[1]).toBe("CSE,CS,4,3,2,1,1,25"); expect(csv[2]).toBe("ECE,EC,0,0,0,0,0,");
  });
});

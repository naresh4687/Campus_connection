import { toCsv } from "./csv";

export const REPORT_TYPES = ["departments", "drives", "companies", "placed"] as const;
export type ReportType = (typeof REPORT_TYPES)[number];
export const REPORT_LABEL: Record<ReportType, string> = { departments: "Departments", drives: "Drives", companies: "Companies", placed: "Placed students" };

/** Share as a whole-number percentage; null when the denominator is zero (never a misleading 0%). */
export const pct = (n: number, d: number): number | null => (d > 0 ? Math.round((n / d) * 1000) / 10 : null);
export const pctText = (n: number, d: number) => { const p = pct(n, d); return p === null ? "—" : `${p}%`; };

export type DeptRow = { code: string; name: string; students: number; registered_students: number; selected_students: number; accepted_students: number; placed_students: number };
export type DriveRow = { drive_id: string; job_title: string; company_name: string; status: string; registered: number; selected: number; offers_issued: number; accepted: number; placed: number };
export type CompanyRow = { company_id: string; company_name: string; drives: number; selected: number; accepted: number; placed: number };
export type PlacedRow = { full_name: string; register_number: string; department_code: string; degree: string; passing_year: number; company_name: string; job_title: string; ctc_lpa: string | null; joined_on: string };

/** CSV text for a report. Every cell goes through csvCell (formula neutralisation + quoting); a UTF-8 BOM lets Excel read non-ASCII names. */
export function reportCsv(type: ReportType, data: unknown[]): string {
  const body = ((): unknown[][] => {
    switch (type) {
      case "departments": return [["Department code", "Department", "Students", "Registered for a drive", "Selected", "Offer accepted", "Placed (verified)", "Placement rate %"],
        ...(data as DeptRow[]).map((r) => [r.code, r.name, r.students, r.registered_students, r.selected_students, r.accepted_students, r.placed_students, pct(r.placed_students, r.students) ?? ""])];
      case "drives": return [["Job title", "Company", "Status", "Registered", "Selected", "Offers issued", "Offers accepted", "Placed (verified)"],
        ...(data as DriveRow[]).map((r) => [r.job_title, r.company_name, r.status, r.registered, r.selected, r.offers_issued, r.accepted, r.placed])];
      case "companies": return [["Company", "Drives", "Selected", "Offers accepted", "Placed (verified)"], ...(data as CompanyRow[]).map((r) => [r.company_name, r.drives, r.selected, r.accepted, r.placed])];
      case "placed": return [["Name", "Register number", "Department", "Degree", "Passing year", "Company", "Job title", "CTC (LPA)", "Joined on"],
        ...(data as PlacedRow[]).map((r) => [r.full_name, r.register_number, r.department_code, r.degree, r.passing_year, r.company_name, r.job_title, r.ctc_lpa ?? "", r.joined_on])];
    }
  })();
  return "﻿" + toCsv(body);
}

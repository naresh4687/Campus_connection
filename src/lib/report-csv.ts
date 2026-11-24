import { toCsv } from "./csv";
import { byCompany, byDepartment, campusEvents, type CampusRoundRow, type FunnelRow, type PlacementRow, type PoolRow } from "./report-calc";
import { pct } from "./reports";

export const FILTERED_REPORTS = ["placed", "unplaced", "departments", "companies", "drives", "campus"] as const;
export type FilteredReport = (typeof FILTERED_REPORTS)[number];
export const FILTERED_LABEL: Record<FilteredReport, string> = { placed: "Placed students", unplaced: "Students not placed", departments: "Departments", companies: "Companies", drives: "Drives", campus: "On-campus drives" };

type Data = { pool: PoolRow[]; placements: PlacementRow[]; funnel: FunnelRow[]; campus: CampusRoundRow[] };

/** CSV for a filtered report. Every cell goes through csvCell (formula neutralisation + quoting); the BOM lets Excel read non-ASCII names. */
export function filteredCsv(type: FilteredReport, d: Data): string {
  const rows = ((): unknown[][] => {
    switch (type) {
      case "placed": return [["Name", "Register number", "Department", "Degree", "Passing year", "College email", "Phone", "CGPA", "Company", "Job title", "CTC (LPA)", "Placed on", "Recorded through", "GitHub", "LeetCode", "LinkedIn"],
        ...d.placements.map((r) => [r.full_name, r.register_number, r.department_code, r.degree, r.passing_year, r.college_email, r.phone ?? "", r.cgpa ?? "", r.company_name, r.job_title ?? "", r.ctc_lpa ?? "", r.placed_on, r.source === "MANUAL" ? "Recorded by staff" : "CampusConnect", r.github_url ?? "", r.leetcode_url ?? "", r.linkedin_url ?? ""])];
      case "unplaced": return [["Name", "Register number", "Department", "Degree", "Passing year", "College email", "Phone", "CGPA", "Drives registered", "Selections", "Offers accepted", "On-campus rounds attended", "GitHub", "LeetCode", "LinkedIn"],
        ...d.pool.filter((p) => !p.placed).map((p) => [p.full_name, p.register_number, p.department_code, p.degree, p.passing_year, p.college_email, p.phone ?? "", p.cgpa ?? "", p.registered, p.selected, p.offers_accepted, p.campus_attended, p.github_url ?? "", p.leetcode_url ?? "", p.linkedin_url ?? ""])];
      case "departments": return [["Department", "Degree", "Students", "Registered for a drive", "Selected", "Offer accepted", "Placed", "Placement rate %", "Average CTC (LPA)", "Highest CTC (LPA)"],
        ...byDepartment(d.pool, d.placements).map((r) => [r.code, r.degree, r.students, r.registered, r.selected, r.accepted, r.placed, r.rate ?? "", r.avgCtc ?? "", r.highestCtc ?? ""])];
      case "companies": return [["Company", "Students placed", "Average CTC (LPA)", "Highest CTC (LPA)"], ...byCompany(d.placements).map((r) => [r.name, r.placed, r.avgCtc ?? "", r.highestCtc ?? ""])];
      case "drives": return [["Job title", "Company", "Status", "Published on", "Registered", "Selected", "Offers issued", "Offers accepted", "Placed", "Registered → placed %"],
        ...d.funnel.map((r) => [r.job_title, r.company_name, r.status, r.published_on, r.registered, r.selected, r.offers_issued, r.accepted, r.placed, pct(r.placed, r.registered) ?? ""])];
      case "campus": return [["Company", "Drive", "Date", "Status", "Round", "Round name", "May attend", "Present", "Eligible for next round"],
        ...campusEvents(d.campus).flatMap((e) => e.rounds.map((r) => [e.company_name, e.title, new Date(e.event_at).toISOString().slice(0, 10), e.event_status, r.round_number, r.round_name, r.eligible, r.present, r.advanced]))];
    }
  })();
  return "﻿" + toCsv(rows);
}

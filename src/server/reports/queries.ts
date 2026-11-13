import { sql } from "kysely";
import type { CompanyRow, DeptRow, DriveRow, PlacedRow } from "@/lib/reports";
import { withSession, type SessionUser } from "../auth/session";

export type Ctc = { placed: number; with_ctc: number; highest: string | null; average: string | null; median: string | null };
const yearOrNull = (y: string | undefined) => (y && /^\d{4}$/.test(y) ? Number(y) : null);
export const parseYear = yearOrNull;

/** Everything on the reports page, in one transaction so the numbers are mutually consistent. */
export async function loadReports(s: SessionUser, year: number | null) {
  return withSession(s, async (t) => ({
    years: (await sql<{ passing_year: number }>`SELECT * FROM reports.years()`.execute(t)).rows.map((r) => r.passing_year),
    departments: (await sql<DeptRow>`SELECT * FROM reports.department_summary(${year}::int)`.execute(t)).rows,
    drives: (await sql<DriveRow>`SELECT * FROM reports.drive_summary(${year}::int)`.execute(t)).rows,
    companies: (await sql<CompanyRow>`SELECT * FROM reports.company_summary(${year}::int)`.execute(t)).rows,
    ctc: (await sql<Ctc>`SELECT placed, with_ctc, highest::text, average::text, median::text FROM reports.ctc_stats(${year}::int)`.execute(t)).rows[0],
    placed: (await sql<PlacedRow>`SELECT full_name, register_number, department_code, degree, passing_year, company_name, job_title, ctc_lpa::text AS ctc_lpa, joined_on::text AS joined_on FROM reports.placed_students(${year}::int)`.execute(t)).rows,
  }));
}

/** One report for CSV export; the export itself is written to the audit log (type and year only). */
export async function exportData(s: SessionUser, type: "departments" | "drives" | "companies" | "placed", year: number | null) {
  return withSession(s, async (t) => {
    await sql`SELECT reports.log_export(${type}, ${year}::int)`.execute(t);
    switch (type) {
      case "departments": return (await sql<DeptRow>`SELECT * FROM reports.department_summary(${year}::int)`.execute(t)).rows;
      case "drives": return (await sql<DriveRow>`SELECT * FROM reports.drive_summary(${year}::int)`.execute(t)).rows;
      case "companies": return (await sql<CompanyRow>`SELECT * FROM reports.company_summary(${year}::int)`.execute(t)).rows;
      case "placed": return (await sql<PlacedRow>`SELECT full_name, register_number, department_code, degree, passing_year, company_name, job_title, ctc_lpa::text AS ctc_lpa, joined_on::text AS joined_on FROM reports.placed_students(${year}::int)`.execute(t)).rows;
    }
  });
}

import { sql } from "kysely";
import type { CampusRoundRow, FunnelRow, PlacementRow, PoolRow } from "@/lib/report-calc";
import type { ReportFilters, ReportView } from "@/lib/report-filters";
import { withSession, type SessionUser } from "../auth/session";

export type FilterOptions = { years: number[]; departments: { id: string; code: string; degree: string | null }[]; companies: { id: string; name: string }[] };

const poolQ = (f: ReportFilters) => sql<PoolRow>`SELECT student_id, full_name, register_number, department_id, department_code, degree, passing_year, college_email, phone, cgpa::text AS cgpa, github_url, leetcode_url, linkedin_url,
  registered, selected, offers_accepted, placed, campus_attended FROM reports.student_pool(${f.year}::int, ${f.dept}::uuid, ${f.degree})`;
const placementsQ = (f: ReportFilters) => sql<PlacementRow>`SELECT student_id, full_name, register_number, department_code, degree, passing_year, college_email, phone, cgpa::text AS cgpa, company_id, company_name, job_title, drive_id,
  ctc_lpa::text AS ctc_lpa, placed_on::text AS placed_on, source, github_url, leetcode_url, linkedin_url FROM reports.placement_rows(${f.year}::int, ${f.dept}::uuid, ${f.degree}, ${f.company}::uuid, NULL::uuid, ${f.from}::date, ${f.to}::date)`;
const funnelQ = (f: ReportFilters) => sql<FunnelRow>`SELECT drive_id, job_title, company_id, company_name, status, published_on::text AS published_on, registered, selected, offers_issued, accepted, placed
  FROM reports.funnel_rows(${f.year}::int, ${f.dept}::uuid, ${f.degree}, ${f.company}::uuid, ${f.from}::date, ${f.to}::date)`;
const campusQ = (f: ReportFilters) => sql<CampusRoundRow>`SELECT * FROM reports.campus_rounds(${f.from}::date, ${f.to}::date)`;

/** Page data for one view, read in one transaction so every figure agrees. The database narrows everything to the caller's college. */
export async function loadReport(s: SessionUser, f: ReportFilters, view: ReportView) {
  return withSession(s, async (t) => {
    const opts = (await sql<{ kind: string; id: string; label: string; extra: string | null }>`SELECT * FROM reports.filter_options()`.execute(t)).rows;
    const years = (await sql<{ passing_year: number }>`SELECT * FROM reports.years()`.execute(t)).rows.map((r) => r.passing_year);
    const options: FilterOptions = {
      years, departments: opts.filter((o) => o.kind === "department").map((o) => ({ id: o.id, code: o.label, degree: o.extra })), companies: opts.filter((o) => o.kind === "company").map((o) => ({ id: o.id, name: o.label })),
    };
    if (view === "campus") return { options, pool: [] as PoolRow[], placements: [] as PlacementRow[], funnel: [] as FunnelRow[], campus: (await campusQ(f).execute(t)).rows };
    const [pool, placements, funnel] = await Promise.all([
      poolQ(f).execute(t).then((r) => r.rows), placementsQ(f).execute(t).then((r) => r.rows), view === "companies" ? funnelQ(f).execute(t).then((r) => r.rows) : Promise.resolve([] as FunnelRow[]),
    ]);
    return { options, pool, placements, funnel, campus: [] as CampusRoundRow[] };
  });
}

/** Rows for a CSV download; the download is written to the audit log (report name and year only). */
export async function exportReport(s: SessionUser, type: "placed" | "unplaced" | "departments" | "companies" | "drives" | "campus", f: ReportFilters) {
  return withSession(s, async (t) => {
    await sql`SELECT reports.log_export(${type === "drives" ? "drives" : type}, ${f.year}::int)`.execute(t);
    if (type === "campus") return { pool: [] as PoolRow[], placements: [] as PlacementRow[], funnel: [] as FunnelRow[], campus: (await campusQ(f).execute(t)).rows };
    const pool = (await poolQ(f).execute(t)).rows; const placements = (await placementsQ(f).execute(t)).rows;
    const funnel = type === "drives" || type === "companies" ? (await funnelQ(f).execute(t)).rows : [];
    return { pool, placements, funnel, campus: [] as CampusRoundRow[] };
  });
}

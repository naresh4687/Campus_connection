/**
 * Pure aggregation over the rows the reporting functions return. Nothing here touches the database, so every figure on the reports page can be
 * recomputed (and unit-tested) from the same rows that the CSV downloads contain.
 */
import { pct } from "./reports";

export type PoolRow = {
  student_id: string; full_name: string; register_number: string; department_id: string; department_code: string; degree: string; passing_year: number; college_email: string;
  phone: string | null; cgpa: string | null; github_url: string | null; leetcode_url: string | null; linkedin_url: string | null;
  registered: number; selected: number; offers_accepted: number; placed: boolean; campus_attended: number;
};
export type PlacementRow = {
  student_id: string; full_name: string; register_number: string; department_code: string; degree: string; passing_year: number; college_email: string; phone: string | null; cgpa: string | null;
  company_id: string; company_name: string; job_title: string | null; drive_id: string | null; ctc_lpa: string | null; placed_on: string; source: "PLATFORM" | "MANUAL";
  github_url: string | null; leetcode_url: string | null; linkedin_url: string | null;
};
export type FunnelRow = { drive_id: string; job_title: string; company_id: string; company_name: string; status: string; published_on: string; registered: number; selected: number; offers_issued: number; accepted: number; placed: number };
export type CampusRoundRow = { event_id: string; company_name: string; title: string; event_at: Date; event_status: string; posted_drive: boolean; round_number: number; round_name: string; round_status: string; eligible: number; present: number; advanced: number };

const num = (v: string | null) => (v === null ? null : Number(v));
export const ctcStats = (ctcs: (string | null)[]) => {
  const v = ctcs.map(num).filter((x): x is number => x !== null).sort((a, b) => a - b);
  if (v.length === 0) return { count: 0, highest: null, average: null, median: null, lowest: null };
  const mid = Math.floor(v.length / 2);
  return { count: v.length, highest: v[v.length - 1], lowest: v[0], average: Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100, median: v.length % 2 ? v[mid] : Math.round(((v[mid - 1] + v[mid]) / 2) * 100) / 100 };
};

/** Distinct students placed (a student with two placements counts once). */
export const placedStudents = (rows: PlacementRow[]) => new Set(rows.map((r) => r.student_id)).size;

export function kpis(pool: PoolRow[], placements: PlacementRow[]) {
  const inScope = new Set(pool.map((p) => p.student_id));
  const rows = placements.filter((r) => inScope.has(r.student_id));
  const placed = placedStudents(rows);
  return {
    students: pool.length, placed, rate: pct(placed, pool.length),
    acceptedUnverified: pool.filter((p) => p.offers_accepted > 0 && !p.placed).length,
    registered: pool.filter((p) => p.registered > 0).length,
    campusAttended: pool.filter((p) => p.campus_attended > 0).length,
    companies: new Set(rows.map((r) => r.company_id)).size,
    placements: rows.length, ctc: ctcStats(rows.map((r) => r.ctc_lpa)),
  };
}

export type DeptAgg = { key: string; code: string; degree: string; students: number; registered: number; selected: number; accepted: number; placed: number; rate: number | null; avgCtc: number | null; highestCtc: number | null };
/** One row per department and degree. */
export function byDepartment(pool: PoolRow[], placements: PlacementRow[]): DeptAgg[] {
  const m = new Map<string, PoolRow[]>();
  for (const p of pool) { const k = `${p.department_code}|${p.degree}`; (m.get(k) ?? m.set(k, []).get(k)!).push(p); }
  const byStudent = Map.groupBy(placements, (r) => r.student_id);
  return [...m.entries()].map(([key, ps]) => {
    const rows = ps.flatMap((p) => byStudent.get(p.student_id) ?? []);
    const placed = new Set(rows.map((r) => r.student_id)).size; const c = ctcStats(rows.map((r) => r.ctc_lpa));
    return { key, code: ps[0].department_code, degree: ps[0].degree, students: ps.length, registered: ps.filter((p) => p.registered > 0).length, selected: ps.filter((p) => p.selected > 0).length,
      accepted: ps.filter((p) => p.offers_accepted > 0).length, placed, rate: pct(placed, ps.length), avgCtc: c.average, highestCtc: c.highest };
  }).sort((a, b) => a.code.localeCompare(b.code) || a.degree.localeCompare(b.degree));
}

export type CompanyAgg = { company_id: string; name: string; placed: number; avgCtc: number | null; highestCtc: number | null };
export function byCompany(placements: PlacementRow[]): CompanyAgg[] {
  return [...Map.groupBy(placements, (r) => r.company_id).values()].map((rs) => {
    const c = ctcStats(rs.map((r) => r.ctc_lpa));
    return { company_id: rs[0].company_id, name: rs[0].company_name, placed: new Set(rs.map((r) => r.student_id)).size, avgCtc: c.average, highestCtc: c.highest };
  }).sort((a, b) => b.placed - a.placed || a.name.localeCompare(b.name));
}

export const CTC_BANDS = [["Below 3 LPA", 0, 3], ["3 – 5 LPA", 3, 5], ["5 – 8 LPA", 5, 8], ["8 – 12 LPA", 8, 12], ["12 – 20 LPA", 12, 20], ["20 LPA and above", 20, Infinity]] as const;
export function ctcBands(placements: PlacementRow[]) {
  const known = placements.map((r) => num(r.ctc_lpa)).filter((x): x is number => x !== null);
  return CTC_BANDS.map(([label, lo, hi]) => ({ label, count: known.filter((c) => c >= lo && c < hi).length }));
}

/** Placements per calendar month (by joining date), oldest first. */
export function monthlyTrend(placements: PlacementRow[]) {
  const m = new Map<string, PlacementRow[]>();
  for (const r of placements) { const k = String(r.placed_on).slice(0, 7); (m.get(k) ?? m.set(k, []).get(k)!).push(r); }
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([month, rs]) => ({ month, placed: new Set(rs.map((r) => r.student_id)).size, avgCtc: ctcStats(rs.map((r) => r.ctc_lpa)).average }));
}
export const monthLabel = (ym: string) => new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export type CampusEventAgg = { event_id: string; company_name: string; title: string; event_at: Date; event_status: string; posted_drive: boolean; rounds: CampusRoundRow[] };
export const campusEvents = (rows: CampusRoundRow[]): CampusEventAgg[] =>
  [...Map.groupBy(rows, (r) => r.event_id).values()].map((rs) => ({ event_id: rs[0].event_id, company_name: rs[0].company_name, title: rs[0].title, event_at: rs[0].event_at, event_status: rs[0].event_status, posted_drive: rs[0].posted_drive, rounds: rs }));

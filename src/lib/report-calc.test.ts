import { describe, expect, it } from "vitest";
import { byCompany, byDepartment, ctcBands, ctcStats, kpis, monthlyTrend, type PlacementRow, type PoolRow } from "./report-calc";
import { anyFilter, filterQuery, parseFilters } from "./report-filters";

const pool = (id: string, dept: string, degree: string, o: Partial<PoolRow> = {}): PoolRow => ({ student_id: id, full_name: id, register_number: id, department_id: dept, department_code: dept, degree, passing_year: 2026, contact_email: `${id}@x.test`,
  phone: null, cgpa: null, github_url: null, leetcode_url: null, linkedin_url: null, registered: 0, selected: 0, offers_accepted: 0, placed: false, campus_attended: 0, ...o });
const pl = (id: string, company: string, ctc: string | null, on: string, o: Partial<PlacementRow> = {}): PlacementRow => ({ student_id: id, full_name: id, register_number: id, department_code: "CSE", degree: "B.E.", passing_year: 2026, contact_email: "", phone: null,
  cgpa: null, company_id: company, company_name: company, job_title: null, drive_id: null, ctc_lpa: ctc, placed_on: on, source: "PLATFORM", github_url: null, leetcode_url: null, linkedin_url: null, ...o });

describe("ctcStats", () => {
  it("highest, average and median over stated CTCs only", () => {
    expect(ctcStats(["4", "8", null, "12"])).toMatchObject({ count: 3, highest: 12, lowest: 4, average: 8, median: 8 });
    expect(ctcStats(["4", "6"])).toMatchObject({ median: 5 });
    expect(ctcStats([null])).toEqual({ count: 0, highest: null, average: null, median: null, lowest: null });
  });
});

describe("aggregation", () => {
  const p = [pool("a", "CSE", "B.E.", { placed: true, registered: 1, offers_accepted: 1 }), pool("b", "CSE", "B.E.", { registered: 1, offers_accepted: 1 }), pool("c", "CSE", "M.E."), pool("d", "ECE", "B.E.", { campus_attended: 2 })];
  const rows = [pl("a", "Acme", "10", "2026-03-10"), pl("a", "Beta", "12", "2026-03-20"), pl("z-outside", "Acme", "99", "2026-04-01")];
  it("kpis count a student once however many placements, ignore placements of students outside the pool, and never show 0% for no students", () => {
    const k = kpis(p, rows);
    expect(k).toMatchObject({ students: 4, placed: 1, rate: 25, acceptedUnverified: 1, registered: 2, campusAttended: 1, companies: 2, placements: 2 });
    expect(kpis([], []).rate).toBeNull();
  });
  it("departments split by degree", () => {
    const d = byDepartment(p, rows);
    expect(d.map((x) => [x.code, x.degree, x.students, x.placed])).toEqual([["CSE", "B.E.", 2, 1], ["CSE", "M.E.", 1, 0], ["ECE", "B.E.", 1, 0]]);
    expect(d[0]).toMatchObject({ rate: 50, avgCtc: 11, highestCtc: 12 });
  });
  it("companies, CTC bands and the monthly trend", () => {
    expect(byCompany(rows).map((c) => [c.name, c.placed])).toEqual([["Acme", 2], ["Beta", 1]]);
    const bands = Object.fromEntries(ctcBands(rows).map((b) => [b.label, b.count]));
    expect(bands["8 – 12 LPA"]).toBe(1); expect(bands["12 – 20 LPA"]).toBe(1); expect(bands["20 LPA and above"]).toBe(1);
    expect(monthlyTrend(rows)).toEqual([{ month: "2026-03", placed: 1, avgCtc: 11 }, { month: "2026-04", placed: 1, avgCtc: 99 }]);
  });
});

describe("filters from the address bar", () => {
  it("keeps only exact valid values", () => {
    const f = parseFilters({ year: "2026", dept: "not-a-uuid", degree: "PhD", company: "6f1f8f3a-0d6c-4f56-8d8e-1b2b3c4d5e6f", from: "2026-02-30", to: "2026-12-31", view: "placed" });
    expect(f).toEqual({ year: 2026, dept: null, degree: null, company: "6f1f8f3a-0d6c-4f56-8d8e-1b2b3c4d5e6f", from: null, to: "2026-12-31", view: "placed" });
  });
  it("an inverted date range is the same range; unknown views fall back to the overview; arrays take the first value", () => {
    expect(parseFilters({ from: "2026-12-01", to: "2026-01-01", view: "hack" })).toMatchObject({ from: "2026-01-01", to: "2026-12-01", view: "overview" });
    expect(parseFilters({ year: ["2025", "2026"] }).year).toBe(2025);
  });
  it("builds query strings and detects an active filter", () => {
    const f = parseFilters({ year: "2026", degree: "B.Tech" });
    expect(filterQuery(f, { view: "placed" })).toBe("?year=2026&degree=B.Tech&view=placed"); expect(anyFilter(f)).toBe(true); expect(anyFilter(parseFilters({}))).toBe(false); expect(filterQuery(parseFilters({}))).toBe("");
  });
});

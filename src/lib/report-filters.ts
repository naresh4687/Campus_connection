import { DEGREES } from "./degrees";

export const REPORT_VIEWS = ["overview", "placed", "unplaced", "departments", "companies", "campus"] as const;
export type ReportView = (typeof REPORT_VIEWS)[number];
export const REPORT_VIEW_LABEL: Record<ReportView, string> = {
  overview: "Overview", placed: "Placed students", unplaced: "Not placed yet", departments: "Departments", companies: "Companies & drives", campus: "On-campus drives",
};

export type ReportFilters = { year: number | null; dept: string | null; degree: string | null; company: string | null; from: string | null; to: string | null; view: ReportView };
export type RawFilters = Partial<Record<"year" | "dept" | "degree" | "company" | "from" | "to" | "view", string | string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v;

/** Everything from the address bar is untrusted: anything that is not exactly a valid value is dropped (never an error). */
export function parseFilters(raw: RawFilters): ReportFilters {
  const year = one(raw.year); const dept = one(raw.dept); const degree = one(raw.degree); const company = one(raw.company);
  const from = one(raw.from); const to = one(raw.to); const view = one(raw.view);
  const f = isDate(from) ? from : null; const t = isDate(to) ? to : null;
  const swap = f && t && f > t;     // an inverted range is the same range
  return {
    year: year && /^\d{4}$/.test(year) ? Number(year) : null,
    dept: dept && UUID.test(dept) ? dept.toLowerCase() : null,
    degree: degree && (DEGREES as readonly string[]).includes(degree) ? degree : null,
    company: company && UUID.test(company) ? company.toLowerCase() : null,
    from: swap ? t : f, to: swap ? f : t,
    view: (REPORT_VIEWS as readonly string[]).includes(view ?? "") ? (view as ReportView) : "overview",
  };
}

/** The filters as a query string (without the view unless asked), for links and downloads. */
export function filterQuery(f: ReportFilters, extra: Partial<Record<string, string>> = {}): string {
  const p = new URLSearchParams();
  if (f.year) p.set("year", String(f.year)); if (f.dept) p.set("dept", f.dept); if (f.degree) p.set("degree", f.degree); if (f.company) p.set("company", f.company);
  if (f.from) p.set("from", f.from); if (f.to) p.set("to", f.to);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}
export const anyFilter = (f: ReportFilters) => !!(f.year || f.dept || f.degree || f.company || f.from || f.to);

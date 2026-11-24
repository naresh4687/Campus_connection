import Link from "next/link";
import { DEGREES } from "@/lib/degrees";
import { anyFilter, type ReportFilters } from "@/lib/report-filters";
import type { FilterOptions } from "@/server/reports/filtered";

const sel = "h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm sm:w-auto";

/** All filters in one GET form, so a filtered view is a plain link that can be bookmarked or shared. */
export function FilterBar({ base, f, options }: { base: string; f: ReportFilters; options: FilterOptions }) {
  return (
    <form method="get" action={base} className="grid grid-cols-2 items-end gap-3 sm:flex sm:flex-wrap print:hidden" role="search" aria-label="Report filters">
      <input type="hidden" name="view" value={f.view} />
      <div className="space-y-1"><label htmlFor="year" className="block text-sm font-medium">Passing year</label>
        <select id="year" name="year" defaultValue={f.year ? String(f.year) : ""} className={sel}><option value="">All batches</option>{options.years.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
      <div className="space-y-1"><label htmlFor="dept" className="block text-sm font-medium">Department</label>
        <select id="dept" name="dept" defaultValue={f.dept ?? ""} className={sel}><option value="">All departments</option>{options.departments.map((d) => <option key={d.id} value={d.id}>{d.code}{d.degree ? ` (${d.degree})` : ""}</option>)}</select></div>
      <div className="space-y-1"><label htmlFor="degree" className="block text-sm font-medium">Degree</label>
        <select id="degree" name="degree" defaultValue={f.degree ?? ""} className={sel}><option value="">All degrees</option>{DEGREES.map((d) => <option key={d} value={d}>{d}</option>)}</select></div>
      <div className="space-y-1"><label htmlFor="company" className="block text-sm font-medium">Company</label>
        <select id="company" name="company" defaultValue={f.company ?? ""} className={sel}><option value="">All companies</option>{options.companies.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="space-y-1"><label htmlFor="from" className="block text-sm font-medium">From date</label><input id="from" name="from" type="date" defaultValue={f.from ?? ""} className={sel} /></div>
      <div className="space-y-1"><label htmlFor="to" className="block text-sm font-medium">To date</label><input id="to" name="to" type="date" defaultValue={f.to ?? ""} className={sel} /></div>
      <button type="submit" className="col-span-2 h-10 rounded-xl sm:col-span-1 border border-border bg-surface px-4 text-sm font-medium hover:bg-tint">Apply</button>
      {anyFilter(f) ? <Link href={`${base}?view=${f.view}`} className="inline-flex h-10 items-center text-sm underline">Clear filters</Link> : null}
    </form>
  );
}

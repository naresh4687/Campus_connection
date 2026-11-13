import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { StatTile } from "@/components/ui/stat";
import { DRIVE_STATUS_LABEL } from "@/lib/drives";
import { fmtDate } from "@/lib/format";
import { pct, pctText, REPORT_LABEL, REPORT_TYPES } from "@/lib/reports";
import type { loadReports } from "@/server/reports/queries";
import { BarChart } from "./bar-chart";
import { PrintButton } from "./print-button";

type Data = Awaited<ReturnType<typeof loadReports>>;

/** One report page for officers and administrators. Every figure is computed by the database from the workflow tables; "placed" means a VERIFIED placement. */
export function ReportsView({ base, data, year }: { base: string; data: Data; year: number | null }) {
  const totals = data.departments.reduce((a, d) => ({ students: a.students + d.students, registered: a.registered + d.registered_students, selected: a.selected + d.selected_students, accepted: a.accepted + d.accepted_students, placed: a.placed + d.placed_students }), { students: 0, registered: 0, selected: 0, accepted: 0, placed: 0 });
  const q = year ? `?year=${year}` : "";
  const money = (v: string | null) => (v === null ? "—" : `${Number(v).toFixed(2)} LPA`);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Placement reports</h1><p className="text-sm text-muted">{year ? `Batch passing out in ${year}` : "All batches"} · generated from live data</p></div>
        <PrintButton />
      </div>
      <form className="flex flex-wrap items-end gap-3 print:hidden" role="search" aria-label="Report filters">
        <div className="space-y-1"><label htmlFor="year" className="block text-sm font-medium">Passing year</label>
          <select id="year" name="year" defaultValue={year ? String(year) : ""} className="h-10 rounded-xl border border-border bg-surface px-3 text-sm"><option value="">All batches</option>{data.years.map((y) => <option key={y} value={y}>{y}</option>)}</select></div>
        <button className="h-10 rounded-xl border border-border bg-surface px-4 text-sm hover:bg-background">Apply</button>
        {year ? <Link href={base} className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>

      <section aria-labelledby="kpi" className="space-y-3">
        <h2 id="kpi" className="text-lg font-semibold">Headline numbers</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Students in scope" value={totals.students} />
          <StatTile label="Students placed" value={totals.placed} hint="Verified placements only" />
          <StatTile label="Placement rate" value={pctText(totals.placed, totals.students)} hint="Placed ÷ students in scope" />
          <StatTile label="Offers accepted, not yet verified" value={Math.max(0, totals.accepted - totals.placed)} hint="Not counted as placements" />
          <StatTile label="Highest CTC" value={money(data.ctc.highest)} hint={data.ctc.with_ctc ? `${data.ctc.with_ctc} verified with a stated CTC` : "No verified placement states a CTC"} />
          <StatTile label="Average CTC" value={money(data.ctc.average)} />
          <StatTile label="Median CTC" value={money(data.ctc.median)} />
          <StatTile label="Registered for a drive" value={totals.registered} />
        </div>
      </section>

      <Card title="By department">
        {data.departments.length === 0 ? <EmptyState title="No departments yet" /> : <>
          <BarChart title="Placement rate by department" unit="%" rows={data.departments.map((d) => ({ label: d.code, value: pct(d.placed_students, d.students), detail: `${d.placed_students}/${d.students} students` }))} />
          <div className="mt-4"><Table head={["Department", "Students", "Registered", "Selected", "Offer accepted", "Placed", "Rate"]}>
            {data.departments.map((d) => (<tr key={d.code}><Td><span className="font-mono text-muted">{d.code}</span> {d.name}</Td><Td>{d.students}</Td><Td>{d.registered_students}</Td><Td>{d.selected_students}</Td><Td>{d.accepted_students}</Td><Td>{d.placed_students}</Td><Td>{pctText(d.placed_students, d.students)}</Td></tr>))}
          </Table></div></>}
        <p className="mt-2 text-xs text-muted">Counts are students (a student selected twice counts once). Withdrawn offers are not counted as selected.</p>
      </Card>

      <Card title="By drive">
        <Table head={["Job", "Company", "Status", "Registered", "Selected", "Offers issued", "Accepted", "Placed"]} empty={data.drives.length === 0 ? <EmptyState title="No published drives yet" /> : undefined}>
          {data.drives.map((d) => (<tr key={d.drive_id}><Td>{d.job_title}</Td><Td>{d.company_name}</Td><Td>{DRIVE_STATUS_LABEL[d.status]}</Td><Td>{d.registered}</Td><Td>{d.selected}</Td><Td>{d.offers_issued}</Td><Td>{d.accepted}</Td><Td>{d.placed}</Td></tr>))}
        </Table>
      </Card>

      <Card title="By company">
        <Table head={["Company", "Drives", "Selected", "Offers accepted", "Placed"]} empty={data.companies.length === 0 ? <EmptyState title="No company activity yet" /> : undefined}>
          {data.companies.map((c) => (<tr key={c.company_id}><Td>{c.company_name}</Td><Td>{c.drives}</Td><Td>{c.selected}</Td><Td>{c.accepted}</Td><Td>{c.placed}</Td></tr>))}
        </Table>
      </Card>

      <Card title="Placed students">
        <Table head={["Name", "Register no.", "Dept", "Company", "Role", "CTC", "Joined"]} empty={data.placed.length === 0 ? <EmptyState title="No verified placements yet">A placement appears here only after the placement office verifies the student’s joining.</EmptyState> : undefined}>
          {data.placed.map((p, i) => (<tr key={i}><Td className="font-medium">{p.full_name}</Td><Td>{p.register_number}</Td><Td>{p.department_code}</Td><Td>{p.company_name}</Td><Td>{p.job_title}</Td><Td>{p.ctc_lpa ? `${Number(p.ctc_lpa).toFixed(2)} LPA` : "—"}</Td><Td>{fmtDate(p.joined_on)}</Td></tr>))}
        </Table>
      </Card>

      <Card title="Download (CSV)">
        <ul className="flex flex-wrap gap-4 text-sm print:hidden" aria-label="Downloads">
          {REPORT_TYPES.map((t) => <li key={t}><a href={`/reports/export/${t}${q}`} className="underline" download>{REPORT_LABEL[t]}</a></li>)}
        </ul>
        <p className="mt-2 text-xs text-muted">Exports contain personal data (the “Placed students” file lists names). Each download is recorded in the audit log. Spreadsheet formulas in names are neutralised.</p>
      </Card>
    </div>
  );
}

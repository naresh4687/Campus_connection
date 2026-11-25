import Link from "next/link";
import { Card } from "@/components/ui/card";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { StatTile } from "@/components/ui/stat";
import { StatusBadge } from "@/components/ui/status-badge";
import { DRIVE_STATUS_LABEL } from "@/lib/drives";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { byCompany, byDepartment, campusEvents, ctcBands, kpis, monthLabel, monthlyTrend, type CampusRoundRow, type FunnelRow, type PlacementRow, type PoolRow } from "@/lib/report-calc";
import { FILTERED_LABEL, type FilteredReport } from "@/lib/report-csv";
import { anyFilter, filterQuery, REPORT_VIEW_LABEL, REPORT_VIEWS, type ReportFilters } from "@/lib/report-filters";
import { pct, pctText } from "@/lib/reports";
import type { FilterOptions } from "@/server/reports/filtered";
import { ProfileLinks } from "@/components/students/profile-links";
import { BarChart } from "./bar-chart";
import { FilterBar } from "./filter-bar";
import { PrintButton } from "./print-button";

export type ReportData = { options: FilterOptions; pool: PoolRow[]; placements: PlacementRow[]; funnel: FunnelRow[]; campus: CampusRoundRow[] };
const lpa = (v: number | string | null) => (v === null ? "—" : `${Number(v).toFixed(2)} LPA`);
const DOWNLOADS: Record<ReportFilters["view"], FilteredReport[]> = { overview: ["placed", "unplaced", "departments", "companies"], placed: ["placed"], unplaced: ["unplaced"], departments: ["departments"], companies: ["companies", "drives"], campus: ["campus"] };

/** One reports page for officers and administrators. Every figure is computed from database rows narrowed by the filters; "placed" means a verified placement of an accepted offer. */
export function ReportsView({ base, data, f }: { base: string; data: ReportData; f: ReportFilters }) {
  const k = kpis(data.pool, data.placements);
  const tab = (v: ReportFilters["view"]) => `${base}${filterQuery(f, { view: v === "overview" ? "" : v })}`;
  const scope = [f.year ? `batch ${f.year}` : "all batches", f.dept ? data.options.departments.find((d) => d.id === f.dept)?.code : null, f.degree, f.company ? data.options.companies.find((c) => c.id === f.company)?.name : null,
    f.from || f.to ? `${f.from ? fmtDate(f.from) : "start"} – ${f.to ? fmtDate(f.to) : "today"}` : null].filter(Boolean).join(" · ");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-2xl font-semibold tracking-tight">Placement reports</h1><p className="text-sm text-muted">{scope} · generated from live data</p></div>
        <PrintButton />
      </div>
      <FilterBar base={base} f={f} options={data.options} />
      <nav aria-label="Report views" className="flex flex-wrap gap-2 print:hidden">
        {REPORT_VIEWS.map((v) => (
          <Link key={v} href={tab(v)} aria-current={f.view === v ? "page" : undefined}
            className={`rounded-full border px-4 py-1.5 text-sm ${f.view === v ? "border-foreground bg-primary font-semibold text-primary-foreground" : "border-border bg-surface hover:bg-tint"}`}>{REPORT_VIEW_LABEL[v]}</Link>
        ))}
      </nav>
      {(f.from || f.to) && f.view !== "campus" ? <p className="text-xs text-muted">The date range applies to the joining date of placements{f.view === "companies" ? " and to the date a drive was published" : ""}. Student totals are not date-limited.</p> : null}

      {f.view === "overview" ? <Overview f={f} data={data} k={k} /> : null}
      {f.view === "placed" ? <Placed rows={data.placements} /> : null}
      {f.view === "unplaced" ? <Unplaced rows={data.pool.filter((p) => !p.placed)} total={data.pool.length} /> : null}
      {f.view === "departments" ? <Departments data={data} /> : null}
      {f.view === "companies" ? <Companies data={data} /> : null}
      {f.view === "campus" ? <Campus rows={data.campus} /> : null}

      <Card title="Download (CSV)">
        <ul className="flex flex-wrap gap-4 text-sm print:hidden" aria-label="Downloads">
          {DOWNLOADS[f.view].map((t) => <li key={t}><a href={`/reports/export/${t}${filterQuery(f)}`} className="underline" download>{FILTERED_LABEL[t]}{anyFilter(f) ? " (with the filters above)" : ""}</a></li>)}
        </ul>
        <p className="mt-2 text-xs text-muted">Exports contain personal data (names, contact details, profile links). Each download is recorded in the audit log. Spreadsheet formulas in names are neutralised.</p>
      </Card>
    </div>
  );
}

function Overview({ f, data, k }: { f: ReportFilters; data: ReportData; k: ReturnType<typeof kpis> }) {
  const depts = byDepartment(data.pool, data.placements); const recruiters = byCompany(data.placements).slice(0, 8);
  const bands = ctcBands(data.placements); const trend = monthlyTrend(data.placements);
  return (
    <>
      <section aria-labelledby="kpi" className="space-y-3">
        <h2 id="kpi" className="text-lg font-semibold">Headline numbers</h2>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 @3xl:grid-cols-4">
          <StatTile label="Students in scope" value={k.students} />
          <StatTile label="Students placed" value={k.placed} hint="Verified placements only" />
          <StatTile label="Placement rate" value={pctText(k.placed, k.students)} hint="Placed ÷ students in scope" />
          <StatTile label="Offers accepted, not yet verified" value={k.acceptedUnverified} hint="Not counted as placements" />
          <StatTile label="Highest CTC" value={lpa(k.ctc.highest)} hint={k.ctc.count ? `${k.ctc.count} placement${k.ctc.count === 1 ? "" : "s"} with a stated CTC` : "No verified placement states a CTC"} />
          <StatTile label="Average CTC" value={lpa(k.ctc.average)} />
          <StatTile label="Median CTC" value={lpa(k.ctc.median)} />
          <StatTile label="Registered for a drive" value={k.registered} />
          <StatTile label="Companies that hired" value={k.companies} />
          <StatTile label="Attended an on-campus drive" value={k.campusAttended} hint="At least one round" />
        </div>
      </section>
      <div className="grid gap-6 @3xl:grid-cols-2">
        <Card title="Placement rate by department">
          {depts.length === 0 ? <EmptyState title="No students match these filters" /> : <BarChart title="Placement rate by department" unit="%" rows={depts.map((d) => ({ label: `${d.code} · ${d.degree}`, value: d.rate, detail: `${d.placed}/${d.students} students` }))} />}
        </Card>
        <Card title="Packages (CTC)">
          {k.ctc.count === 0 ? <EmptyState title="No placement states a CTC">Offers and manually recorded placements show here once they carry a CTC.</EmptyState> : <BarChart title="Placements by CTC band" rows={bands.map((b) => ({ label: b.label, value: b.count, detail: `${pct(b.count, k.ctc.count) ?? 0}%` }))} />}
        </Card>
        <Card title="Placements by month">
          {trend.length === 0 ? <EmptyState title="No placements in this period" /> : <BarChart title="Students placed per month (by joining date)" rows={trend.map((m) => ({ label: monthLabel(m.month), value: m.placed, detail: m.avgCtc ? `avg ${lpa(m.avgCtc)}` : "" }))} />}
        </Card>
        <Card title="Top recruiters">
          {recruiters.length === 0 ? <EmptyState title="No placements yet" /> : <BarChart title="Students placed by company" rows={recruiters.map((c) => ({ label: c.name, value: c.placed, detail: c.highestCtc ? `up to ${lpa(c.highestCtc)}` : "" }))} />}
        </Card>
      </div>
      {anyFilter(f) ? null : <p className="text-xs text-muted">Use the filters above to see one department, degree, company or period — every view and download follows them.</p>}
    </>
  );
}

function Placed({ rows }: { rows: PlacementRow[] }) {
  return (
    <Card title={`Placed students (${rows.length})`}>
      <Table head={["Name", "Register no.", "Dept", "Degree", "CGPA", "Company", "Role", "CTC", "Placed on", "Contact", "Profiles"]} empty={rows.length === 0 ? <EmptyState title="No placements match these filters">A placement appears here once it is verified.</EmptyState> : undefined}>
        {rows.map((p, i) => (
          <tr key={`${p.student_id}-${i}`}>
            <Td className="font-medium">{p.full_name}<span className="block text-xs text-muted">Batch {p.passing_year}</span></Td><Td>{p.register_number}</Td><Td>{p.department_code}</Td><Td>{p.degree}</Td><Td>{p.cgpa ?? "—"}</Td>
            <Td>{p.company_name}{p.source === "MANUAL" ? <span className="block text-xs text-muted">Recorded by staff</span> : null}</Td><Td>{p.job_title ?? "—"}</Td><Td>{p.ctc_lpa ? lpa(p.ctc_lpa) : "—"}</Td><Td>{fmtDate(p.placed_on)}</Td>
            <Td><span className="break-all">{p.contact_email ?? "Personal email not added"}</span>{p.phone ? <span className="block text-xs text-muted">{p.phone}</span> : null}</Td>
            <Td><ProfileLinks st={p} empty="—" /></Td>
          </tr>))}
      </Table>
    </Card>
  );
}

function Unplaced({ rows, total }: { rows: PoolRow[]; total: number }) {
  return (
    <Card title={`Not placed yet (${rows.length} of ${total})`}>
      <Table head={["Name", "Register no.", "Dept", "Degree", "CGPA", "Drives registered", "Selections", "Offers accepted", "On-campus rounds", "Contact", "Profiles"]} empty={rows.length === 0 ? <EmptyState title="Everyone in this selection is placed" /> : undefined}>
        {rows.map((p) => (
          <tr key={p.student_id}>
            <Td className="font-medium">{p.full_name}<span className="block text-xs text-muted">Batch {p.passing_year}</span></Td><Td>{p.register_number}</Td><Td>{p.department_code}</Td><Td>{p.degree}</Td><Td>{p.cgpa ?? "—"}</Td>
            <Td>{p.registered}</Td><Td>{p.selected}</Td><Td>{p.offers_accepted}</Td><Td>{p.campus_attended}</Td>
            <Td><span className="break-all">{p.contact_email ?? "Personal email not added"}</span>{p.phone ? <span className="block text-xs text-muted">{p.phone}</span> : null}</Td>
            <Td><ProfileLinks st={p} empty="—" /></Td>
          </tr>))}
      </Table>
      <p className="mt-2 text-xs text-muted">A student with an accepted offer that is not yet verified still appears here until the placement office verifies the joining. CGPA is the coordinator-verified value.</p>
    </Card>
  );
}

function Departments({ data }: { data: ReportData }) {
  const depts = byDepartment(data.pool, data.placements);
  return (
    <Card title="By department and degree">
      {depts.length === 0 ? <EmptyState title="No students match these filters" /> : <>
        <BarChart title="Placement rate by department" unit="%" rows={depts.map((d) => ({ label: `${d.code} · ${d.degree}`, value: d.rate, detail: `${d.placed}/${d.students} students` }))} />
        <div className="mt-4"><Table head={["Department", "Degree", "Students", "Registered", "Selected", "Offer accepted", "Placed", "Rate", "Average CTC", "Highest CTC"]}>
          {depts.map((d) => (<tr key={d.key}><Td><span className="font-mono">{d.code}</span></Td><Td>{d.degree}</Td><Td>{d.students}</Td><Td>{d.registered}</Td><Td>{d.selected}</Td><Td>{d.accepted}</Td><Td>{d.placed}</Td><Td>{pctText(d.placed, d.students)}</Td><Td>{lpa(d.avgCtc)}</Td><Td>{lpa(d.highestCtc)}</Td></tr>))}
        </Table></div></>}
      <p className="mt-2 text-xs text-muted">Counts are students (a student selected twice counts once). Withdrawn offers are not counted as selected.</p>
    </Card>
  );
}

function Companies({ data }: { data: ReportData }) {
  const cos = byCompany(data.placements);
  return (
    <>
      <Card title="Placements by company">
        <Table head={["Company", "Students placed", "Average CTC", "Highest CTC"]} empty={cos.length === 0 ? <EmptyState title="No placements match these filters" /> : undefined}>
          {cos.map((c) => (<tr key={c.company_id}><Td className="font-medium">{c.name}</Td><Td>{c.placed}</Td><Td>{lpa(c.avgCtc)}</Td><Td>{lpa(c.highestCtc)}</Td></tr>))}
        </Table>
      </Card>
      <Card title="Drive funnel">
        <Table head={["Job", "Company", "Status", "Published", "Registered", "Selected", "Offers issued", "Accepted", "Placed", "Registered → placed"]} empty={data.funnel.length === 0 ? <EmptyState title="No published drives match these filters" /> : undefined}>
          {data.funnel.map((d) => (<tr key={d.drive_id}><Td>{d.job_title}</Td><Td>{d.company_name}</Td><Td>{DRIVE_STATUS_LABEL[d.status] ?? d.status}</Td><Td>{fmtDate(d.published_on)}</Td><Td>{d.registered}</Td><Td>{d.selected}</Td><Td>{d.offers_issued}</Td><Td>{d.accepted}</Td><Td>{d.placed}</Td><Td>{pctText(d.placed, d.registered)}</Td></tr>))}
        </Table>
        <p className="mt-2 text-xs text-muted">Only students who match the department, degree and batch filters are counted in each drive.</p>
      </Card>
    </>
  );
}

function Campus({ rows }: { rows: CampusRoundRow[] }) {
  const events = campusEvents(rows);
  if (events.length === 0) return <Card><EmptyState title="No on-campus drives in this period">Create one under On-campus drives to track attendance round by round.</EmptyState></Card>;
  return (
    <>
      {events.map((e) => (
        <Card key={e.event_id} title={e.company_name}>
          <p className="mb-3 text-sm text-muted">{e.title} · {fmtDateTime(e.event_at)} · <StatusBadge value={e.event_status === "UPCOMING" ? "ACTIVE" : e.event_status} label={e.event_status === "UPCOMING" ? "Upcoming" : e.event_status === "COMPLETED" ? "Completed" : e.event_status} />{e.posted_drive ? " · posted drive" : ""}</p>
          <Table head={["Round", "Name", "May attend", "Attended", "Attendance", "Eligible for next round"]}>
            {e.rounds.map((r) => (<tr key={r.round_number}><Td>{r.round_number}</Td><Td>{r.round_name}</Td><Td>{r.eligible}</Td><Td>{r.present}</Td><Td>{pctText(r.present, r.eligible)}</Td><Td>{r.advanced}</Td></tr>))}
          </Table>
        </Card>))}
      <p className="text-xs text-muted"><Link href="/placement/campus" className="underline">Manage on-campus drives</Link></p>
    </>
  );
}

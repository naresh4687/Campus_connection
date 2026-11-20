import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { StackedBars } from "@/components/charts/charts";
import { ELIGIBILITY_TEXT, VIEWS, VIEW_LABEL, WHO, WHO_LABEL, countRows, filterRows, parseView, parseWho, registrationText, type PartRow } from "@/lib/participation";
import { fmtDateTime } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getDrive } from "@/server/drives/queries";
import { participation } from "@/server/registrations/queries";
import { linkableDrives } from "@/server/announcements/queries";
import { ReminderForms } from "./reminders";

type Role = "PLACEMENT_OFFICER" | "COORDINATOR";
type SP = { view?: string; who?: string; dept?: string };

/** One drive, student by student: who registered, who has not, filterable by department, with reminders and a download. The same page serves officers and coordinators; the database narrows what each can see. */
export async function ParticipationView({ role, id, sp }: { role: Role; id: string; sp: SP }) {
  const s = await requireRole(role);
  if (!uuidSchema.safeParse(id).success) notFound();
  const base = role === "COORDINATOR" ? `/coordinator/drives/${id}` : `/placement/drives/${id}/participation`;
  const dept = sp.dept && uuidSchema.safeParse(sp.dept).success ? sp.dept : "";
  const view = parseView(sp.view); const who = parseWho(sp.who, view);
  let all: PartRow[];
  try { all = await participation(s, id, null); } catch (e) { if ((e as { code?: string }).code === "22023") notFound(); throw e; }
  // Drive details: an officer reads the drive; a coordinator takes the name from the list of drives open to their departments.
  const drive = role === "PLACEMENT_OFFICER" ? (await getDrive(s, id))?.drive ?? null : null;
  const lite = role === "COORDINATOR" ? (await linkableDrives(s)).find((d) => d.id === id) ?? null : null;
  const title = drive ? `${drive.job_title} — ${drive.company_name}` : lite ? `${lite.job_title} — ${lite.company_name}` : "Drive";
  const open = drive ? drive.status === "PUBLISHED" && !!drive.application_deadline && new Date(drive.application_deadline) > new Date() : lite?.status === "PUBLISHED";
  const scoped = dept ? all.filter((r) => r.department_id === dept) : all;
  const c = countRows(scoped);
  const rows = filterRows(scoped, view, who);
  const depts = [...new Map(all.map((r) => [r.department_id, r.department_code])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const per = depts.map(([d, code]) => { const x = countRows(all.filter((r) => r.department_id === d)); return { label: code, parts: [{ label: "Registered", value: x.registered, tone: "ink" as const }, { label: "Started", value: x.pending, tone: "amber" as const }, { label: "Not registered", value: x.eligible - x.registered - x.pending > 0 ? x.eligible - x.registered - x.pending : 0, tone: "red" as const }] }; });
  const qs = (o: Partial<SP>) => { const p = new URLSearchParams(); const m = { view, who, dept, ...o }; for (const [k, v] of Object.entries(m)) if (v) p.set(k, v); return `?${p.toString()}`; };
  const downloadHref = `${base}/download${qs({})}`;
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href={role === "COORDINATOR" ? "/coordinator/drives" : `/placement/drives/${id}`} className="underline">← {role === "COORDINATOR" ? "Drives" : "Drive"}</Link></p>
      <h1>Registration status</h1>
      <p className="text-sm text-muted">{title}{drive?.application_deadline ? ` · apply by ${fmtDateTime(drive.application_deadline)}` : ""}</p>
      <dl aria-label="Summary" className="grid grid-cols-2 gap-px border border-border bg-border text-sm @3xl:grid-cols-5">
        {([["Eligible students", c.eligible], ["Registered", c.registered], ["Started, not finished", c.pending], ["Eligible, not registered", c.toChase - c.pending > 0 ? c.toChase - c.pending : 0], ["Need verified data", c.needsData]] as const).map(([k, v]) => (
          <div key={k} className="bg-surface p-4"><dt className="text-xs uppercase tracking-wide text-muted">{k}</dt><dd className="mt-1 text-2xl font-bold tabular-nums" data-testid={`part-${k}`}>{v}</dd></div>))}
      </dl>
      {depts.length > 1 ? <Card title="By department"><StackedBars title="Eligible students by department" rows={per} legend={[{ label: "Registered", tone: "ink" }, { label: "Started", tone: "amber" }, { label: "Not registered", tone: "red" }]} /></Card> : null}
      <Card title="Students">
        <form method="get" className="mb-4 flex flex-wrap items-end gap-3" aria-label="Filter students">
          <label className="space-y-1 text-sm font-semibold">Show<select name="view" defaultValue={view} className="mt-1 block h-10 border border-border bg-surface px-3 text-sm font-normal">{VIEWS.map((v) => <option key={v} value={v}>{VIEW_LABEL[v]}</option>)}</select></label>
          <label className="space-y-1 text-sm font-semibold">Eligibility<select name="who" defaultValue={who} className="mt-1 block h-10 border border-border bg-surface px-3 text-sm font-normal">{WHO.map((v) => <option key={v} value={v}>{WHO_LABEL[v]}</option>)}</select></label>
          <label className="space-y-1 text-sm font-semibold">Department<select name="dept" defaultValue={dept} className="mt-1 block h-10 border border-border bg-surface px-3 text-sm font-normal"><option value="">{role === "COORDINATOR" ? "All my departments" : "All departments"}</option>{depts.map(([d, code]) => <option key={d} value={d}>{code}</option>)}</select></label>
          <button type="submit" className="h-10 border border-border bg-surface px-4 text-sm font-medium hover:bg-tint">Apply filters</button>
          <a href={downloadHref} className="inline-flex h-10 items-center bg-primary px-4 text-sm font-semibold text-primary-foreground" data-testid="download-csv">Download CSV ({rows.length})</a>
        </form>
        <Table head={["Register no.", "Student", "Dept", "Contact", "Eligibility", "Registration"]} empty={rows.length === 0 ? <EmptyState title="No students match">Change the filters above.</EmptyState> : null}>
          {rows.map((r) => (
            <tr key={r.student_id}>
              <Td>{r.register_number}</Td><Td>{r.full_name}{r.has_account ? null : <span className="block text-xs text-muted">No account yet</span>}</Td><Td>{r.department_code}</Td>
              <Td><span className="break-all">{r.college_email}</span>{r.phone ? <span className="block text-xs text-muted">{r.phone}</span> : null}</Td>
              <Td>{ELIGIBILITY_TEXT[r.eligibility] ?? r.eligibility}</Td><Td>{registrationText(r)}</Td>
            </tr>))}
        </Table>
        <p className="mt-2 text-xs text-muted">Eligibility is the platform’s own result from each student’s verified record. Downloads contain student contact details and are recorded in the audit log.</p>
      </Card>
      <Card title="Follow up">
        {c.toChase === 0 ? <Alert kind="success">Every eligible student{dept ? " in this department" : ""} has completed their registration.</Alert> : null}
        <ReminderForms drive={id} dept={dept} toChase={c.toChase} canNotifyCoordinators={role === "PLACEMENT_OFFICER"} open={!!open} />
      </Card>
    </div>
  );
}

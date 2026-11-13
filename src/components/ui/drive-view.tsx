import { criteriaLines, employmentLabel } from "@/lib/drives";
import { fmtDateTime } from "@/lib/format";
import type { Criteria, DriveDetail } from "@/server/drives/queries";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (<><dt className="text-muted">{k}</dt><dd className="whitespace-pre-wrap">{v}</dd></>);
}

/** Read-only drive details exactly as a student would read them. Unset criteria are not listed (they are never zero). */
export function DriveView({ drive: d, criteria, departments }: { drive: DriveDetail; criteria: Criteria; departments: { code: string; name: string }[] }) {
  const lines = criteriaLines(criteria);
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
        <Row k="Company" v={d.company_name} />
        <Row k="Job title" v={d.job_title} />
        <Row k="Type" v={employmentLabel(d.employment_type)} />
        <Row k="Location" v={d.location ?? "—"} />
        <Row k="CTC / package" v={d.ctc_lpa ? `${Number(d.ctc_lpa).toFixed(2)} LPA${d.ctc_note ? ` — ${d.ctc_note}` : ""}` : d.ctc_note ?? "Not stated"} />
        <Row k="Openings" v={d.openings ?? "—"} />
        <Row k="Apply by" v={d.application_deadline ? fmtDateTime(d.application_deadline) : "—"} />
        <Row k="Qualification" v={d.qualification ?? "—"} />
        <Row k="Bond" v={d.bond_details ?? "None stated"} />
        <Row k="Description" v={d.job_description ?? "—"} />
        <Row k="Interview details" v={d.interview_details ?? "—"} />
        <Row k="Instructions" v={d.instructions ?? "—"} />
      </dl>
      <div>
        <h3 className="text-sm font-semibold">Eligibility</h3>
        <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm" aria-label="Eligibility criteria">
          <li>Departments: {departments.length ? departments.map((x) => x.code).join(", ") : "none chosen"}</li>
          {lines.map((l) => <li key={l}>{l}</li>)}
        </ul>
        <p className="mt-1 text-xs text-muted">Eligibility is decided by the platform from your verified academic record, never by hand.</p>
      </div>
    </div>
  );
}

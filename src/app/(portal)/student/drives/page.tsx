import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { DRIVE_STATUS_LABEL, employmentLabel } from "@/lib/drives";
import { ELIGIBILITY_LABEL } from "@/lib/eligibility";
import { fmtDateTime } from "@/lib/format";
import { registrationView } from "@/lib/evidence";
import { requireRole } from "@/server/auth/session";
import { myDrives } from "@/server/registrations/queries";

export const metadata = { title: "Drives — CampusConnect" };

export default async function StudentDrives() {
  const s = await requireRole("STUDENT");
  const rows = await myDrives(s);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Placement drives</h1>
      <p className="text-sm text-muted">Your eligibility is decided by the platform from your <strong>verified</strong> academic record. If it says “Needs verified data”, open Academics first.</p>
      <Table head={["Job", "Company", "Type", "Apply by", "Drive", "Your eligibility", "Your registration"]} empty={rows.length === 0 ? <EmptyState title="No drives yet">Published drives appear here.</EmptyState> : undefined}>
        {rows.map((d) => (
          <tr key={d.id}>
            <Td><Link href={`/student/drives/${d.id}`} className="font-medium underline">{d.job_title}</Link></Td>
            <Td>{d.company_name}</Td><Td>{employmentLabel(d.employment_type)}</Td>
            <Td>{fmtDateTime(d.application_deadline)}</Td>
            <Td>{DRIVE_STATUS_LABEL[d.status]}</Td>
            <Td><StatusBadge value={d.result} label={ELIGIBILITY_LABEL[d.result]} /></Td>
            <Td>{d.registration_status ? (() => { const v = registrationView({ status: d.registration_status, method: d.method, evidence_status: d.evidence_status }); return <StatusBadge value={v.tone} label={v.label} />; })() : <span className="text-muted">Not registered</span>}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

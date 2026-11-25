import { ProfileLinks } from "@/components/students/profile-links";
import { StatusBadge } from "@/components/ui/status-badge";
import { registrationView } from "@/lib/evidence";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { DriveCountsView } from "@/components/ui/drive-counts";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getDrive } from "@/server/drives/queries";
import { StudentEvidence } from "@/components/evidence/student-evidence";
import { applicants, driveCounts, driveEvidence } from "@/server/registrations/queries";

export const metadata = { title: "Applicants — CampusConnect" };

export default async function Applicants({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getDrive(s, id);
  if (!data) notFound();
  const [rows, counts, evidence] = await Promise.all([applicants(s, id), driveCounts(s, id), driveEvidence(s, id)]);
  const anyExternal = evidence.size > 0;
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href={`/placement/drives/${id}`} className="underline">← {data.drive.job_title}</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Applicants — {data.drive.company_name}</h1>
      <Card title="Counts"><DriveCountsView c={counts} /></Card>
      <Card title="Registered students">
        <Table head={["Student", "Register no.", "Dept", "Contact", "CGPA", "10th", "12th / Diploma", "Backlogs", "Registered", "How", "Résumé", "Profiles", ...(anyExternal ? ["Screenshot"] : [])]} empty={rows.length === 0 ? <EmptyState title="No registrations yet">Students appear here once they register.</EmptyState> : undefined}>
          {rows.map((r) => (
            <tr key={r.student_id}>
              <Td className="font-medium">{r.full_name}</Td><Td>{r.register_number}</Td><Td>{r.department_code}</Td>
              <Td>{r.contact_email ?? <span className="text-muted">Personal email not added</span>}{r.phone ? <span className="block text-xs text-muted">{r.phone}</span> : null}</Td>
              <Td>{r.cgpa ?? "—"}</Td><Td>{r.tenth ?? "—"}</Td><Td>{r.twelfth ?? r.diploma ?? "—"}</Td>
              <Td>{r.active_backlogs ?? "—"} / {r.historical_arrears ?? "—"}</Td><Td>{fmtDateTime(r.registered_at)}</Td><Td>{(() => { const v = registrationView({ status: "REGISTERED", method: r.method, evidence_status: r.evidence_status }); return r.method === "EXTERNAL" ? <StatusBadge value={v.tone} label={v.label} /> : "CampusConnect"; })()}</Td>
              <Td>{r.resume_id ? <a href={`/documents/${r.resume_id}/download`} className="underline">Open résumé</a> : <span className="text-muted">None uploaded</span>}</Td>
              <Td><ProfileLinks st={{ github_url: r.github_url ?? null, leetcode_url: r.leetcode_url ?? null, linkedin_url: r.linkedin_url ?? null }} empty="—" /></Td>
              {anyExternal ? <Td>{r.method === "EXTERNAL" ? <StudentEvidence e={evidence.get(r.student_id)} /> : <span className="text-muted">—</span>}</Td> : null}
            </tr>
          ))}
        </Table>
        <p className="mt-2 text-xs text-muted">Marks shown are the coordinator-verified values the student was judged on at registration. Opening a résumé is logged.</p>
      </Card>
    </div>
  );
}

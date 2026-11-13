import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { DriveView } from "@/components/ui/drive-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { DRIVE_STATUS_LABEL } from "@/lib/drives";
import { CHECK_LABEL, CRITERION_LABEL, ELIGIBILITY_LABEL } from "@/lib/eligibility";
import { fmtDateTime } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getDrive } from "@/server/drives/queries";
import { myEligibility } from "@/server/registrations/queries";
import { myRounds } from "@/server/rounds/queries";
import { RESULT_LABEL, RESULT_TONE, roundKindLabel } from "@/lib/rounds";
import { RegisterForm } from "../register-form";

export const metadata = { title: "Drive — CampusConnect" };
const NOTICE: Record<string, string> = { registered: "You are registered for this drive.", withdrawn: "Your registration was withdrawn." };

export default async function StudentDrive({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const s = await requireRole("STUDENT");
  const { id } = await params;
  const { notice } = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getDrive(s, id);
  if (!data) notFound();
  const { drive: d } = data;
  const e = await myEligibility(s, id);
  const registered = e.registration?.status === "REGISTERED";
  const rounds = registered ? await myRounds(s, id) : [];
  const open = d.status === "PUBLISHED" && !!d.application_deadline && new Date(d.application_deadline) > new Date();
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/student/drives" className="underline">← Drives</Link></p>
      {notice && NOTICE[notice] ? <Alert kind="success">{NOTICE[notice]}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{d.job_title}</h1><span className="text-muted">{d.company_name}</span><span className="text-sm text-muted">{DRIVE_STATUS_LABEL[d.status]}</span></div>
      <Card title="Your eligibility">
        <p className="flex flex-wrap items-center gap-2 text-sm"><StatusBadge value={e.result} label={ELIGIBILITY_LABEL[e.result]} />{e.registration ? <StatusBadge value={e.registration.status} /> : null}</p>
        <Table head={["Criterion", "Required", "Your value", "Result"]} empty={undefined}>
          {e.checks.map((c, i) => (
            <tr key={i}>
              <Td>{CRITERION_LABEL[c.criterion] ?? c.criterion}</Td><Td>{c.required ?? "—"}</Td><Td>{c.actual ?? "—"}</Td>
              <Td><span className="font-medium">{CHECK_LABEL[c.status]}</span>{c.message ? <span className="block text-xs text-muted">{c.message}</span> : null}</Td>
            </tr>
          ))}
        </Table>
        {e.checks.length === 0 ? <EmptyState title="No checks">Nothing to evaluate.</EmptyState> : null}
        <p className="mt-2 text-xs text-muted">Only your coordinator-verified academic record is used. A value that is missing is never treated as zero.</p>
      </Card>
      <Card title="Registration">
        {registered ? <p className="mb-3 text-sm">You registered on {fmtDateTime(e.registration!.registered_at)}.</p> : null}
        {open && (registered || e.result === "ELIGIBLE") ? <RegisterForm id={d.id} registered={registered} />
          : <p className="text-sm text-muted">{!open ? "Registration is closed for this drive." : e.result === "NEEDS_DATA" ? "Get your academic record verified to register." : "You are not eligible to register for this drive."}</p>}
        <p className="mt-2 text-xs text-muted">Eligibility, the deadline and the drive status are checked again by the server when you register.</p>
      </Card>
      {rounds.length > 0 ? (
        <Card title="Recruitment rounds">
          <ol className="space-y-3 text-sm" aria-label="Rounds">
            {rounds.map((r) => (
              <li key={r.id} className="rounded-md border border-border p-3">
                <p className="font-medium">Round {r.round_number}: {r.name} <span className="font-normal text-muted">({roundKindLabel(r.kind)})</span></p>
                <p className="text-muted">{r.scheduled_at ? fmtDateTime(r.scheduled_at) : "Date to be announced"}{r.venue ? ` · ${r.venue}` : ""}</p>
                {r.instructions ? <p className="mt-1 whitespace-pre-wrap">{r.instructions}</p> : null}
                <p className="mt-2">{r.result ? <><span className="text-muted">Your result: </span><StatusBadge value={RESULT_TONE[r.result]} label={RESULT_LABEL[r.result]} /></> : <span className="text-muted">Result: not released yet</span>}</p>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
      <Card title="Drive details"><DriveView drive={d} criteria={data.criteria} departments={data.departments} /></Card>
    </div>
  );
}

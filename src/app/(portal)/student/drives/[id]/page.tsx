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
import { StartExternal, UploadScreenshot } from "../external-panel";
import { EVIDENCE_LABEL, registrationView } from "@/lib/evidence";
import { evidenceHistory } from "@/server/registrations/queries";

export const metadata = { title: "Drive — CampusConnect" };
const NOTICE: Record<string, string> = {
  registered: "You are registered for this drive.", withdrawn: "Your registration was withdrawn.",
  "external-started": "Your registration is started. Open the company’s form below, complete it, then come back and upload a screenshot of the confirmation page.",
  "evidence-submitted": "Your external registration screenshot has been submitted successfully.",
};

export default async function StudentDrive({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const s = await requireRole("STUDENT");
  const { id } = await params;
  const { notice, error } = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getDrive(s, id);
  if (!data) notFound();
  const { drive: d } = data;
  const e = await myEligibility(s, id);
  const registered = e.registration?.status === "REGISTERED";
  const external = d.registration_method === "EXTERNAL";
  const reg = e.registration;
  const view = registrationView({ status: reg?.status ?? null, method: reg?.method, evidence_status: reg?.evidence_status });
  const history = reg && reg.method === "EXTERNAL" ? await evidenceHistory(s, reg.id) : [];
  const latest = history[0];
  const rounds = registered ? await myRounds(s, id) : [];
  const open = d.status === "PUBLISHED" && !!d.application_deadline && new Date(d.application_deadline) > new Date();
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/student/drives" className="underline">← Drives</Link></p>
      {notice && NOTICE[notice] ? <Alert kind="success">{NOTICE[notice]}</Alert> : null}
      {error ? <Alert kind="error">{error.slice(0, 300)}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{d.job_title}</h1><span className="text-muted">{d.company_name}</span><span className="text-sm text-muted">{DRIVE_STATUS_LABEL[d.status]}</span></div>
      <Card title="Registration">
        <p className="mb-2 text-sm"><span className="text-muted">Registration method: </span><strong>{external ? "Through the company’s website" : "CampusConnect (one click)"}</strong></p>
        {external ? (
          <div className="space-y-4">
            {d.external_instructions ? <p className="whitespace-pre-wrap text-sm">{d.external_instructions}</p> : null}
            {reg?.status === "REGISTERED" ? (
              <div className="space-y-1 text-sm" data-testid="external-status">
                <p>Registration status: <strong>REGISTERED</strong></p>
                <p className="text-muted">Your registration is complete. Your screenshot is saved as proof{latest ? ` (${fmtDateTime(latest.submitted_at)})` : ""}. You can replace it below until the deadline.</p>
                {open && reg.evidence_status !== "REJECTED" && reg.evidence_status !== "RESUBMISSION_REQUIRED" ? (
                  <details className="pt-1"><summary className="cursor-pointer font-medium">Replace the screenshot</summary><div className="mt-2"><UploadScreenshot id={d.id} replace /></div></details>
                ) : null}
              </div>
            ) : null}
            {reg?.status === "PENDING_EXTERNAL" ? (
              <div className="space-y-3" data-testid="external-pending">
                <p className="text-sm">{view.next}</p>
                {reg.external_url ? <p><a href={reg.external_url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-medium underline">Open the company’s registration form (new tab)</a></p> : null}
                <p className="text-xs text-muted">Complete the company’s external registration form. After submitting it, return to CampusConnect and upload a screenshot of the final confirmation page. You can leave this page and come back; your registration stays pending until you upload it.</p>
                {open || (reg.late_ok_until && new Date(reg.late_ok_until) > new Date()) ? <UploadScreenshot id={d.id} replace={false} /> : <Alert kind="info">The deadline for this drive has passed, so your registration is still pending and has not been completed. Ask the placement office whether a late screenshot can be accepted.</Alert>}
              </div>
            ) : null}
            {reg?.status === "REGISTERED" && (reg.evidence_status === "REJECTED" || reg.evidence_status === "RESUBMISSION_REQUIRED") ? (
              <div className="space-y-3" data-testid="external-action">
                <Alert kind="error">{view.next}{latest?.review_note ? <span className="mt-1 block">Reason: {latest.review_note}</span> : null}</Alert>
                <UploadScreenshot id={d.id} replace />
              </div>
            ) : null}
            {history.length ? (
              <details className="text-sm"><summary className="cursor-pointer font-medium">Your screenshots ({history.length})</summary>
                <ul className="mt-2 space-y-1.5">{history.map((h) => (
                  <li key={h.id}>Version {h.version} · {fmtDateTime(h.submitted_at)} · <strong>{EVIDENCE_LABEL[h.status] ?? h.status}</strong>{h.review_note ? <span className="text-muted"> — {h.review_note}</span> : null} · <a className="underline" href={`/evidence/${h.id}/download`} target="_blank" rel="noopener noreferrer">View</a></li>))}
                </ul></details>) : null}
            {(!reg || reg.status === "WITHDRAWN") && open && e.result === "ELIGIBLE" ? <StartExternal id={d.id} /> : null}
            {(!reg || reg.status === "WITHDRAWN") && !(open && e.result === "ELIGIBLE") ? <p className="text-sm text-muted">{!open ? "Registration is closed for this drive." : e.result === "NEEDS_DATA" ? "Get your academic record verified to register." : "You are not eligible to register for this drive."}</p> : null}
          </div>
        ) : (
          <>
            {registered ? <p className="mb-3 text-sm">You registered on {fmtDateTime(e.registration!.registered_at)}.</p> : null}
            {open && (registered || e.result === "ELIGIBLE") ? <RegisterForm id={d.id} registered={registered} />
              : <p className="text-sm text-muted">{!open ? "Registration is closed for this drive." : e.result === "NEEDS_DATA" ? "Get your academic record verified to register." : "You are not eligible to register for this drive."}</p>}
          </>
        )}
        <p className="mt-2 text-xs text-muted">Eligibility, the deadline and the drive status are checked again by the server when you register.</p>
      </Card>
      <Card title="Your eligibility">
        <p className="flex flex-wrap items-center gap-2 text-sm"><StatusBadge value={e.result} label={ELIGIBILITY_LABEL[e.result]} />{e.registration && e.registration.status !== "WITHDRAWN" ? <StatusBadge value={view.tone} label={view.label} /> : null}</p>
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
      {rounds.length > 0 ? (
        <Card title="Recruitment rounds">
          <ol className="space-y-3 text-sm" aria-label="Rounds">
            {rounds.map((r) => (
              <li key={r.id} className="rounded-xl border border-border p-3">
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

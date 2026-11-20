import Link from "next/link";
import { EVIDENCE_LABEL } from "@/lib/evidence";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { evidenceInbox } from "@/server/registrations/queries";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { ReviewControls } from "./review-row";

const TONE: Record<string, string> = { SUBMITTED_PENDING_REVIEW: "PENDING", VERIFIED: "APPROVED", REJECTED: "REJECTED", RESUBMISSION_REQUIRED: "REJECTED" };

/** The screenshots waiting for this reviewer, then the recent decisions. An officer sees the whole college; a coordinator only their departments (the database decides). */
const DECIDED: Record<string, string> = { VERIFIED: "Marked verified.", REJECTED: "Rejected. The student was told why.", RESUBMISSION_REQUIRED: "The student was asked for a new screenshot." };

export async function EvidenceInbox({ role, all, decided }: { role: "PLACEMENT_OFFICER" | "COORDINATOR"; all: boolean; decided?: string }) {
  const s = await requireRole(role);
  const rows = await evidenceInbox(s, !all);
  const base = role === "COORDINATOR" ? "/coordinator/evidence" : "/placement/evidence";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">External registration screenshots</h1>
        <Link href={all ? base : `${base}?all=1`} className="text-sm underline">{all ? "Show only those waiting for review" : "Show decided ones too"}</Link>
      </div>
      {decided && DECIDED[decided] ? <Alert kind="success">{DECIDED[decided]}</Alert> : null}
      <p className="text-sm text-muted">Students who registered through a company’s website upload a screenshot of its confirmation page. A screenshot is evidence, not proof: check that it shows this student, this company and a submitted form.</p>
      {rows.length === 0 ? <Card><p className="text-sm text-muted">{all ? "No screenshots yet." : "Nothing is waiting for review."}</p></Card> : null}
      <ul className="space-y-4">
        {rows.map((r) => (
          <li key={r.registration_id}><Card>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><p className="font-semibold">{r.full_name} <span className="font-normal text-muted">· {r.register_number} · {r.department_code}</span></p>
                <p className="text-sm text-muted">{r.company_name} — {r.job_title}</p>
                <p className="mt-1 text-xs text-muted">Version {r.version} of {r.versions} · submitted {fmtDateTime(r.submitted_at)}</p></div>
              <StatusBadge value={TONE[r.evidence_status] ?? "PENDING"} label={EVIDENCE_LABEL[r.evidence_status] ?? r.evidence_status} />
            </div>
            <p className="mt-3 text-sm"><a href={`/evidence/${r.evidence_id}/download`} target="_blank" rel="noopener noreferrer" className="underline">Open the screenshot (new tab)</a></p>
            {r.review_note ? <p className="mt-1 text-sm text-muted">Last decision{r.reviewed_by_name ? ` by ${r.reviewed_by_name}` : ""}: {r.review_note}</p> : null}
            <div className="mt-3"><ReviewControls evidenceId={r.evidence_id} status={r.evidence_status} /></div>
          </Card></li>
        ))}
      </ul>
    </div>
  );
}

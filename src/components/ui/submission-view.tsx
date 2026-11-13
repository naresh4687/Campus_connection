import { StatusBadge } from "@/components/ui/status-badge";
import { SUBMISSION_LABEL, fmtCgpa, fmtPct, type SubmissionValues } from "@/lib/academics";
import { fmtDateTime } from "@/lib/format";

type S = SubmissionValues & { status?: string; version?: number; student_note?: string | null; submitted_at?: Date; reviewed_by_name?: string | null; reviewed_at?: Date | null; review_note?: string | null; rejection_reason?: string | null };

const TONE: Record<string, string> = { SUBMITTED: "PENDING", VERIFIED: "APPROVED", REJECTED: "REJECTED", SUPERSEDED: "NOT_STARTED", WITHDRAWN: "NOT_STARTED" };

/** Read-only presentation of one academic submission. Missing marks are shown as "Not provided", never as 0. */
export function SubmissionValuesView({ s }: { s: S }) {
  return (
    <dl className="grid grid-cols-[11rem_1fr] gap-y-2 text-sm">
      <dt className="text-muted">CGPA</dt><dd data-testid="v-cgpa">{fmtCgpa(s.cgpa)}</dd>
      <dt className="text-muted">10th percentage</dt><dd data-testid="v-tenth">{fmtPct(s.tenth_percentage)}</dd>
      <dt className="text-muted">12th percentage</dt><dd data-testid="v-twelfth">{fmtPct(s.twelfth_percentage)}</dd>
      <dt className="text-muted">Diploma percentage</dt><dd data-testid="v-diploma">{fmtPct(s.diploma_percentage)}</dd>
      <dt className="text-muted">Active backlogs</dt><dd data-testid="v-backlogs">{s.active_backlogs}</dd>
      <dt className="text-muted">Historical arrears</dt><dd data-testid="v-arrears">{s.historical_arrears}</dd>
      {s.student_note ? (<><dt className="text-muted">Student&apos;s note</dt><dd className="whitespace-pre-wrap">{s.student_note}</dd></>) : null}
    </dl>
  );
}

/** One row of a verification history list. */
export function HistoryItem({ s }: { s: S & { status: string; version: number; submitted_at: Date } }) {
  return (
    <li className="space-y-2 py-4" data-testid={`history-v${s.version}`}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="font-medium">Version {s.version}</span>
        <StatusBadge value={TONE[s.status]} label={SUBMISSION_LABEL[s.status]} />
        <span className="text-muted">submitted {fmtDateTime(s.submitted_at)}</span>
        {s.reviewed_by_name ? <span className="text-muted">· reviewed by {s.reviewed_by_name} on {fmtDateTime(s.reviewed_at)}</span> : null}
      </div>
      <p className="text-sm text-muted">CGPA {fmtCgpa(s.cgpa)} · 10th {fmtPct(s.tenth_percentage)} · 12th {fmtPct(s.twelfth_percentage)} · diploma {fmtPct(s.diploma_percentage)} · backlogs {s.active_backlogs} · arrears {s.historical_arrears}</p>
      {s.rejection_reason ? <p className="rounded-md border border-danger/40 px-3 py-2 text-sm"><strong>Reason:</strong> <span className="whitespace-pre-wrap">{s.rejection_reason}</span></p> : null}
      {s.review_note ? <p className="text-sm"><strong>Reviewer&apos;s note:</strong> {s.review_note}</p> : null}
    </li>
  );
}

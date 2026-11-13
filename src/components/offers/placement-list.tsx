import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { PLACEMENT_LABEL, PLACEMENT_TONE } from "@/lib/offers";
import type { PlacementRow } from "@/server/offers/queries";
import { ReasonForm, VerifyForm } from "./forms";

/** Joining records with their evidence. Officers decide pending ones; administrators may override a decision with a reason. */
export function PlacementList({ rows, mode }: { rows: PlacementRow[]; mode: "officer" | "admin" }) {
  if (rows.length === 0) return <p className="text-sm text-muted">Nothing here.</p>;
  return (
    <ul className="space-y-4" aria-label="Joining records">
      {rows.map((r) => (
        <li key={r.selection_id} className="rounded-xl border border-border p-4">
          <p className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium">{r.full_name}</span><span className="text-muted">{r.register_number} · {r.department_code}</span>
            <StatusBadge value={PLACEMENT_TONE[r.status]} label={PLACEMENT_LABEL[r.status]} />{r.overridden ? <StatusBadge value="PENDING" label="Overridden by administrator" /> : null}</p>
          <p className="mt-1 text-sm">{r.job_title} at {r.company_name} · joined {fmtDate(r.joined_on)}{r.designation ? ` as ${r.designation}` : ""}</p>
          {r.note ? <p className="text-sm text-muted">Student’s note: {r.note}</p> : null}
          <p className="mt-1 text-sm"><a href={`/offer-files/${r.evidence_file_id}/download`} className="underline">Open joining proof</a> <span className="text-muted">· recorded {fmtDateTime(r.recorded_at)}</span></p>
          {r.decided_at ? <p className="text-sm text-muted">Decided by {r.decided_by_name} · {fmtDateTime(r.decided_at)}{r.decision_reason ? ` — “${r.decision_reason}”` : ""}</p> : null}
          <div className="mt-3 space-y-3">
            {mode === "officer" && r.status === "PENDING_VERIFICATION" ? <><VerifyForm selectionId={r.selection_id} /><ReasonForm kind="reject" fields={{ selectionId: r.selection_id }} label="Reason for not verifying" button="Do not verify" /></> : null}
            {mode === "admin" && r.status === "VERIFIED" ? <ReasonForm kind="override-reject" fields={{ selectionId: r.selection_id }} label="Reason for the override (at least 10 characters)" button="Override: mark as not verified" /> : null}
            {mode === "admin" && r.status !== "VERIFIED" ? <VerifyForm selectionId={r.selection_id} override /> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

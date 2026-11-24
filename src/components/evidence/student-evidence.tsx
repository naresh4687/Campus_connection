import { EVIDENCE_LABEL } from "@/lib/evidence";
import { fmtDateTime } from "@/lib/format";
import type { DriveEvidenceRow } from "@/server/registrations/queries";

/** One student's screenshot inside a registered-students table: just open it (it is proof kept on file; nobody reviews it). */
export function StudentEvidence({ e }: { e: DriveEvidenceRow | undefined }) {
  if (!e?.evidence_id) return <span className="text-muted">None uploaded</span>;
  return (
    <p className="text-sm"><a href={`/evidence/${e.evidence_id}/download`} target="_blank" rel="noopener noreferrer" className="underline">Open screenshot (new tab)</a>
      <span className="block text-xs text-muted">{e.submitted_at ? fmtDateTime(e.submitted_at) : ""}{e.versions > 1 ? ` · replaced ${e.versions - 1} time${e.versions === 2 ? "" : "s"}` : ""}{e.evidence_status && !["SUBMITTED_PENDING_REVIEW", "VERIFIED"].includes(e.evidence_status) ? ` · ${EVIDENCE_LABEL[e.evidence_status] ?? e.evidence_status}` : ""}</span></p>
  );
}

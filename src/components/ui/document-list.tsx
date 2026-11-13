import { StatusBadge } from "@/components/ui/status-badge";
import { TYPE_LABEL, fmtBytes, kindLabel } from "@/lib/documents";
import { fmtDateTime } from "@/lib/format";
import type { Doc, DocEvent } from "@/server/documents/queries";
import type { ReactNode } from "react";

const REVIEW_LABEL: Record<string, string> = { NOT_REQUIRED: "No review needed", PENDING: "Awaiting review", VERIFIED: "Verified", REJECTED: "Rejected" };
const REVIEW_TONE: Record<string, string> = { NOT_REQUIRED: "NOT_STARTED", PENDING: "PENDING", VERIFIED: "APPROVED", REJECTED: "REJECTED" };
const EVENT_LABEL: Record<string, string> = { UPLOADED: "Uploaded", DELETED: "Deleted", VERIFIED: "Verified", REJECTED: "Rejected", ACCESSED: "Viewed" };

/** Download is a plain link to the authorising endpoint; it never exposes a storage URL in the page. */
export const downloadHref = (id: string) => `/documents/${id}/download`;

export function DocumentItem({ doc, events, actions, showAccess = false }: { doc: Doc; events?: DocEvent[]; actions?: ReactNode; showAccess?: boolean }) {
  const deleted = doc.status === "DELETED";
  const visible = (events ?? []).filter((e) => showAccess || e.event !== "ACCESSED");
  return (
    <li className="space-y-2 py-4" data-testid={`doc-${doc.original_name}`}>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {deleted ? <span className="font-medium line-through">{doc.original_name}</span> : <a href={downloadHref(doc.id)} className="font-medium underline">{doc.original_name}</a>}
        <span className="text-muted">{kindLabel(doc.kind)} · {TYPE_LABEL[doc.content_type] ?? doc.content_type} · {fmtBytes(doc.size_bytes)} · uploaded {fmtDateTime(doc.uploaded_at)}</span>
        {deleted ? <StatusBadge value="NOT_STARTED" label="Deleted" /> : <StatusBadge value={REVIEW_TONE[doc.review_status]} label={REVIEW_LABEL[doc.review_status]} />}
        {doc.scan_status === "NOT_SCANNED" && !deleted ? <span className="text-xs text-muted">not virus-scanned</span> : null}
      </div>
      {doc.review_status === "REJECTED" && doc.review_reason ? <p className="rounded-xl border border-danger/40 px-3 py-2 text-sm"><strong>Reason:</strong> <span className="whitespace-pre-wrap">{doc.review_reason}</span> <span className="text-muted">— {doc.reviewed_by_name}</span></p> : null}
      {doc.review_status === "VERIFIED" ? <p className="text-xs text-muted">Verified by {doc.reviewed_by_name} on {fmtDateTime(doc.reviewed_at)}.</p> : null}
      {visible.length > 1 || (visible.length === 1 && visible[0].event !== "UPLOADED") ? (
        <details>
          <summary className="cursor-pointer text-xs underline">History ({visible.length})</summary>
          <ul className="mt-1 space-y-0.5 text-xs text-muted" aria-label="Document history">{visible.map((e, i) => <li key={i}>{EVENT_LABEL[e.event]} by {e.actor_name} ({e.actor_role.toLowerCase().replace("_", " ")}) · {fmtDateTime(e.occurred_at)}{e.detail ? ` — ${e.detail}` : ""}</li>)}</ul>
        </details>
      ) : null}
      {actions && !deleted ? <div className="pt-1">{actions}</div> : null}
    </li>
  );
}

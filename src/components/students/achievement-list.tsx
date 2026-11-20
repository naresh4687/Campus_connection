import { StatusBadge } from "@/components/ui/status-badge";
import { ACHIEVEMENT_STATUS_LABEL, ACHIEVEMENT_TONE, KIND_LABEL } from "@/lib/achievements";
import { fmtDate } from "@/lib/format";
import type { Achievement } from "@/server/achievements/queries";

/** Read-only list of achievements. Entries that are not verified say so; the link is shown as text and opens in a new tab without referrer. */
export function AchievementList({ items, actions }: { items: Achievement[]; actions?: (a: Achievement) => React.ReactNode }) {
  if (items.length === 0) return <p className="text-sm text-muted">No achievements added yet.</p>;
  return (
    <ul className="divide-y divide-border" aria-label="Achievements">
      {items.map((a) => (
        <li key={a.id} className="space-y-1.5 py-3" data-testid="achievement-item">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="font-medium">{a.title}</span>
            <span className="text-muted">{KIND_LABEL[a.kind]} · {fmtDate(a.achieved_on)}</span>
            <StatusBadge value={ACHIEVEMENT_TONE[a.status]} label={ACHIEVEMENT_STATUS_LABEL[a.status]} />
            {a.replaces_id ? <StatusBadge value="PENDING" label="Change to a verified entry" /> : null}
            {a.has_open_revision ? <StatusBadge value="PENDING" label="Change awaiting review" /> : null}
          </div>
          {a.description ? <p className="whitespace-pre-wrap text-sm">{a.description}</p> : null}
          {a.link ? <p className="break-all text-sm"><a href={a.link} target="_blank" rel="noopener noreferrer nofollow" className="underline">{a.link}</a></p> : null}
          {a.status === "VERIFIED" && a.reviewed_by_name ? <p className="text-xs text-muted">Verified by {a.reviewed_by_name} on {fmtDate(a.reviewed_at)}.{a.review_note ? ` Note: ${a.review_note}` : ""}</p> : null}
          {a.status === "REJECTED" ? <p className="rounded-xl border border-danger/40 px-3 py-2 text-sm"><strong>Reason:</strong> <span className="whitespace-pre-wrap">{a.rejection_reason}</span></p> : null}
          {actions ? actions(a) : null}
        </li>
      ))}
    </ul>
  );
}

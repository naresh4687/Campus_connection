import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDate } from "@/lib/format";
import type { DriveHistoryRow } from "@/server/students/queries";

const OFFER: Record<string, string> = { NOT_ISSUED: "Offer not issued yet", ISSUED: "Offer issued", ACCEPTED: "Offer accepted", DECLINED: "Offer declined", WITHDRAWN: "Offer withdrawn" };
const PLACEMENT: Record<string, string> = { PENDING_VERIFICATION: "Joining awaiting verification", VERIFIED: "Placed (joining verified)", REJECTED: "Joining not accepted" };

/** Read-only drive history for the 360 view. The package is shown only when the server returned it (administrator). */
export function DriveHistory({ rows }: { rows: DriveHistoryRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted">This student has not registered for any drive.</p>;
  const placed = rows.find((r) => r.placement_status === "VERIFIED");
  return (
    <div className="space-y-3">
      <p className="text-sm" data-testid="placement-summary">{placed ? <>Placed at <strong>{placed.company_name}</strong> — {placed.job_title}{placed.joined_on ? `, joined ${fmtDate(placed.joined_on)}` : ""}.</> : "Not placed yet (no verified joining)."}</p>
      <ul className="divide-y divide-border" aria-label="Drive history">
        {rows.map((r) => (
          <li key={r.drive_id} className="space-y-1 py-3" data-testid="drive-history-item">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{r.company_name}</span><span className="text-muted">{r.job_title} · registered {fmtDate(r.registered_at)}</span>
              {r.registration_status === "WITHDRAWN" ? <StatusBadge value="DISABLED" label="Withdrawn" /> : null}
              {r.selected ? <StatusBadge value="ACTIVE" label="Selected" /> : null}
              {r.offer_status ? <StatusBadge value="PENDING" label={OFFER[r.offer_status] ?? r.offer_status} /> : null}
              {r.placement_status ? <StatusBadge value={r.placement_status === "VERIFIED" ? "ACTIVE" : "PENDING"} label={PLACEMENT[r.placement_status] ?? r.placement_status} /> : null}
            </div>
            {r.offered_ctc_lpa ? <p className="text-xs text-muted">Offered package: {r.offered_ctc_lpa} LPA</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

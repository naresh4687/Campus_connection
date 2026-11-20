import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import type { ManualPlacement } from "@/server/manual-placements/queries";
import type { ReactNode } from "react";

const TONE: Record<string, string> = { PENDING_VERIFICATION: "PENDING", VERIFIED: "APPROVED", REJECTED: "REJECTED" };
const LABEL: Record<string, string> = { PENDING_VERIFICATION: "Waiting for verification", VERIFIED: "Verified", REJECTED: "Rejected" };

/** Placements recorded by coordinators (or officers): student, company, package and status. `actions` adds a column of per-row controls (the officer's verify/reject). */
export function ManualPlacementList({ rows, actions, showCompany = true }: { rows: ManualPlacement[]; actions?: (r: ManualPlacement) => ReactNode; showCompany?: boolean }) {
  return (
    <Table head={["Student", ...(showCompany ? ["Company"] : []), "Dept", "Offer", "Recorded", "Status", ...(actions ? [""] : [])]} empty={rows.length === 0 ? <EmptyState title="Nothing recorded yet">Placements recorded by coordinators appear here.</EmptyState> : null}>
      {rows.map((r) => (
        <tr key={r.id}>
          <Td>{r.full_name}<span className="block text-xs text-muted">{r.register_number}</span></Td>{showCompany ? <Td>{r.company_name}</Td> : null}<Td>{r.department_code}</Td>
          <Td><StatusBadge value={r.offer_status === "ACCEPTED" ? "APPROVED" : "PENDING"} label={r.offer_status === "ACCEPTED" ? "Accepted offer" : "Got offer"} /><span className="mt-1 block"><strong className="tabular-nums">{Number(r.ctc_lpa).toFixed(2)}</strong> LPA</span>{r.note ? <span className="block text-xs text-muted">{r.note}</span> : null}</Td>
          <Td>{fmtDate(r.recorded_at)}<span className="block text-xs text-muted">by a {r.recorded_role.toLowerCase().replace("_", " ")}</span></Td>
          <Td><StatusBadge value={TONE[r.status] ?? "PENDING"} label={LABEL[r.status] ?? r.status} />{r.review_note ? <span className="block text-xs text-muted">{r.review_note}</span> : null}</Td>
          {actions ? <Td>{actions(r)}</Td> : null}
        </tr>))}
    </Table>
  );
}

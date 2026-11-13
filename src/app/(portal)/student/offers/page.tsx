import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { OFFER_STATUS_LABEL, OFFER_TONE, PLACEMENT_LABEL, PLACEMENT_TONE } from "@/lib/offers";
import { requireRole } from "@/server/auth/session";
import { myOffers } from "@/server/offers/queries";

export const metadata = { title: "My offers — CampusConnect" };

export default async function MyOffers() {
  const s = await requireRole("STUDENT");
  const rows = await myOffers(s);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">My offers</h1>
      <Table head={["Job", "Company", "Status", "Respond by", "Placement"]} empty={rows.length === 0 ? <EmptyState title="No offers yet">When a company selects you, it appears here.</EmptyState> : undefined}>
        {rows.map((o) => (
          <tr key={o.id}>
            <Td><Link href={`/student/offers/${o.id}`} className="font-medium underline">{o.job_title}</Link></Td><Td>{o.company_name}</Td>
            <Td><StatusBadge value={OFFER_TONE[o.offer_status]} label={OFFER_STATUS_LABEL[o.offer_status]} /></Td>
            <Td>{o.offer_status === "ISSUED" ? fmtDateTime(o.response_deadline) : "—"}</Td>
            <Td>{o.placement_status ? <StatusBadge value={PLACEMENT_TONE[o.placement_status]} label={PLACEMENT_LABEL[o.placement_status]} /> : "—"}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

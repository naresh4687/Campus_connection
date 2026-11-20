import Link from "next/link";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { KIND_LABEL, isKind } from "@/lib/announcements";
import { fmtDateTime } from "@/lib/format";
import { myAnnouncements } from "@/server/announcements/queries";
import { requireRole } from "@/server/auth/session";

export const metadata = { title: "Announcements — CampusConnect" };

export default async function StudentAnnouncements() {
  const s = await requireRole("STUDENT");
  const rows = await myAnnouncements(s);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Placement announcements</h1>
      <Table head={["Title", "Type", "Company", "Received", ""]} empty={rows.length === 0 ? <EmptyState title="No announcements yet">Announcements addressed to you appear here.</EmptyState> : null}>
        {rows.filter((a) => a.status !== "ARCHIVED").map((a) => (
          <tr key={a.id}>
            <Td><Link href={`/student/announcements/${a.id}`} className="font-medium underline">{a.title}</Link></Td>
            <Td>{isKind(a.kind) ? KIND_LABEL[a.kind] : a.kind}</Td><Td>{a.company_name ?? "—"}</Td><Td>{fmtDateTime(a.notified_at)}</Td>
            <Td>{a.seen_at ? null : <StatusBadge value="NEW" label="New" />}</Td>
          </tr>))}
      </Table>
    </div>
  );
}

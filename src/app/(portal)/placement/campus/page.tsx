import Link from "next/link";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { StatusBadge } from "@/components/ui/status-badge";
import { EVENT_STATUS_LABEL } from "@/lib/campus";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { listCampusEvents } from "@/server/campus/queries";

export const metadata = { title: "On-campus drives — CampusConnect" };

export default async function CampusEvents() {
  const s = await requireRole("PLACEMENT_OFFICER");
  const rows = await listCampusEvents(s);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">On-campus drives</h1>
        <ButtonLink href="/placement/campus/new">Create an on-campus drive</ButtonLink>
      </div>
      <p className="max-w-2xl text-sm text-muted">Run a company’s visit round by round: share each round’s attendance link, see who came, and mark who goes on to the next round.</p>
      <Table head={["Drive", "Date", "Venue", "Rounds", "Attended round 1", "Status"]} empty={rows.length === 0 ? <EmptyState title="No on-campus drives yet">Create one to get attendance links.</EmptyState> : undefined}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td><Link href={`/placement/campus/${r.id}`} className="font-medium underline">{r.company_name}</Link><span className="block text-xs text-muted">{r.title}{r.drive_id ? " · posted drive" : ""}</span></Td>
            <Td>{fmtDateTime(r.event_at)}</Td><Td>{r.venue ?? "—"}</Td><Td>{r.rounds}{r.open_rounds > 0 ? <span className="block text-xs text-muted">{r.open_rounds} open now</span> : null}</Td>
            <Td>{r.present_first}</Td><Td><StatusBadge value={r.status === "UPCOMING" ? "ACTIVE" : r.status} label={EVENT_STATUS_LABEL[r.status]} /></Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

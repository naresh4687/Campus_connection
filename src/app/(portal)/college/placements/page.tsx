import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { FunnelView } from "@/components/offers/funnel";
import { PlacementList } from "@/components/offers/placement-list";
import { requireRole } from "@/server/auth/session";
import { funnel, listPlacements } from "@/server/offers/queries";

export const metadata = { title: "Placements — CampusConnect" };

export default async function AdminPlacements({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const { notice } = await searchParams;
  const [f, rows] = await Promise.all([funnel(s), listPlacements(s, null)]);
  return (
    <div className="space-y-6">
      {notice === "overridden" ? <Alert kind="success">Override recorded. It is flagged on the record and in the audit log.</Alert> : null}
      <h1 className="text-2xl font-semibold tracking-tight">Placements</h1>
      <Card title="Funnel"><FunnelView f={f} role="ADMIN" /></Card>
      <Card title="Who does what"><ol className="list-decimal space-y-1 pl-5 text-sm"><li><strong>Placement officers</strong> select students from a drive’s final round and issue each offer.</li><li><strong>Students</strong> accept or decline on their own Offers page.</li><li><strong>Placement officers</strong> record joining with evidence and verify it. Only verified joinings count as placements.</li><li><strong>You</strong> can read everything here and override a decision with a written reason (below).</li></ol></Card>
      <Card title="Joining records and overrides">
        <p className="mb-3 text-sm text-muted">Placement officers verify joining records. As administrator you may override a decision; a reason of at least 10 characters is required and the record is marked as overridden.</p>
        <PlacementList rows={rows} mode="admin" />
      </Card>
    </div>
  );
}

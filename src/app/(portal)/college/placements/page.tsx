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
      <Card title="Funnel"><FunnelView f={f} /></Card>
      <Card title="Joining records and overrides">
        <p className="mb-3 text-sm text-muted">Placement officers verify joining records. As administrator you may override a decision; a reason of at least 10 characters is required and the record is marked as overridden.</p>
        <PlacementList rows={rows} mode="admin" />
      </Card>
    </div>
  );
}

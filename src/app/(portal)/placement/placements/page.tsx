import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { FunnelView } from "@/components/offers/funnel";
import { PlacementList } from "@/components/offers/placement-list";
import { requireRole } from "@/server/auth/session";
import { funnel, listPlacements } from "@/server/offers/queries";

export const metadata = { title: "Placements — CampusConnect" };
const NOTICE: Record<string, string> = { verified: "Placement verified. It now counts as a placement.", rejected: "Joining record not verified. The student can see your reason and submit a correction." };

export default async function Placements({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const { notice } = await searchParams;
  const [f, pending, verified, rejected] = await Promise.all([funnel(s), listPlacements(s, "PENDING_VERIFICATION"), listPlacements(s, "VERIFIED"), listPlacements(s, "REJECTED")]);
  return (
    <div className="space-y-6">
      {notice && NOTICE[notice] ? <Alert kind="success">{NOTICE[notice]}</Alert> : null}
      <h1 className="text-2xl font-semibold tracking-tight">Placements</h1>
      <Card title="Funnel"><FunnelView f={f} /><p className="mt-2 text-xs text-muted">Only verified placements count as placements. Accepted offers and recorded joinings are shown separately.</p></Card>
      <Card title={`Awaiting verification (${pending.length})`}><PlacementList rows={pending} mode="officer" /></Card>
      <Card title={`Verified placements (${verified.length})`}><PlacementList rows={verified} mode="officer" /></Card>
      <Card title={`Not verified (${rejected.length})`}><PlacementList rows={rejected} mode="officer" /></Card>
    </div>
  );
}

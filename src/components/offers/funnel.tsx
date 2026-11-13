import type { Funnel } from "@/server/offers/queries";

/** Five different numbers on purpose: an accepted offer is never counted as a placement. */
export function FunnelView({ f }: { f: Funnel }) {
  const items: [string, number][] = [["Selected", f.selected], ["Offers issued", f.offers_issued], ["Offers accepted", f.offers_accepted], ["Joining recorded", f.joining_recorded], ["Verified placements", f.placements_verified]];
  return (
    <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5" aria-label="Placement funnel">
      {items.map(([k, v]) => (<div key={k} className="rounded-xl border border-border bg-surface p-3"><dt className="text-muted">{k}</dt><dd className="text-xl font-semibold">{v}</dd></div>))}
    </dl>
  );
}

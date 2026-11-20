import { MetricGrid } from "@/components/ui/metrics";
import type { Funnel } from "@/server/offers/queries";

/**
 * Five different numbers on purpose: an accepted offer is never counted as a placement. Each stage says who moves a student to it and, for an officer,
 * where: the funnel itself only counts, the work happens on the drive's "Selections and offers" page and on the Placements list.
 */
export function FunnelView({ f, role }: { f: Funnel; role?: "OFFICER" | "ADMIN" }) {
  const officer = role === "OFFICER";
  const h = <T,>(x: T) => (role ? x : undefined);          // dashboards show the bare counts; the Placements pages explain each step
  return (
    <MetricGrid label="Placement funnel" items={[
      { label: "Selected", value: f.selected, href: officer ? "#manage-offers" : undefined, hint: h(officer ? "Choose a drive below → Select students." : "Placement officers pick selected students from a drive's final round.") },
      { label: "Offers issued", value: f.offers_issued, href: officer ? "#manage-offers" : undefined, hint: h(officer ? "Issue each offer with a letter and a response deadline." : "Issued by placement officers.") },
      { label: "Offers accepted", value: f.offers_accepted, hint: h("The student accepts or declines on their Offers page. Nobody else can accept for them.") },
      { label: "Joining recorded", value: f.joining_recorded, hint: h(officer ? "Record joining with evidence on the drive's offers page." : "Recorded by placement officers with evidence.") },
      { label: "Verified placements", value: f.placements_verified, href: officer ? "#awaiting-verification" : undefined, hint: h(officer ? "Verify each joining record below." : "Verified by placement officers; you can override with a reason.") },
    ]} />
  );
}

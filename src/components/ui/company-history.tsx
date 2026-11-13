import { fmtDateTime } from "@/lib/format";

const LABEL: Record<string, string> = { CREATED: "Created", UPDATED: "Updated", DEACTIVATED: "Deactivated", REACTIVATED: "Reactivated" };
export function CompanyHistory({ events }: { events: { event: string; actor_name: string; detail: string | null; occurred_at: Date }[] }) {
  return (
    <ul className="space-y-1 text-sm" aria-label="Company history">
      {events.map((e, i) => <li key={i}><span className="font-medium">{LABEL[e.event]}</span> by {e.actor_name} <span className="text-muted">· {fmtDateTime(e.occurred_at)}{e.detail ? ` · ${e.detail}` : ""}</span></li>)}
    </ul>
  );
}

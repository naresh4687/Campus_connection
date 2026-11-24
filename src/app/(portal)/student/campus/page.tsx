import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/table";
import { EVENT_STATUS_LABEL } from "@/lib/campus";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { myCampusEvents, type MyCampusRow } from "@/server/campus/queries";
import { MarkButton } from "./mark-button";

export const metadata = { title: "On-campus drives — CampusConnect" };

/** What this round means for me, in words. */
function myStatus(r: MyCampusRow): { label: string; tone: string } {
  if (r.present && r.advanced) return { label: "Present — eligible for the next round", tone: "ACTIVE" };
  if (r.present) return { label: r.round_status === "CLOSED" ? "Present — not moving to the next round" : "Present", tone: r.round_status === "CLOSED" ? "NEUTRAL" : "ACTIVE" };
  if (!r.eligible) return { label: "Not on the list for this round", tone: "NEUTRAL" };
  if (r.round_status === "OPEN") return { label: "Attendance open — mark yourself present", tone: "PENDING" };
  if (r.round_status === "CLOSED") return { label: "Attendance closed — you were not marked present", tone: "REJECTED" };
  return { label: "You may attend — attendance has not opened", tone: "PENDING" };
}

export default async function StudentCampus() {
  const s = await requireRole("STUDENT");
  const rows = await myCampusEvents(s);
  const events = [...Map.groupBy(rows, (r) => r.event_id).values()];
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">On-campus drives</h1>
      <p className="max-w-2xl text-sm text-muted">When a company visits your campus, mark your attendance for each round here (or with the link your placement office shares). You go to the next round only if the placement office marks you eligible.</p>
      {events.length === 0 ? <Card><EmptyState title="No on-campus drives for you right now">When the placement office creates one that includes you, it appears here and you get a notification.</EmptyState></Card> : null}
      {events.map((rs) => {
        const e = rs[0];
        return (
          <Card key={e.event_id} title={e.company_name}>
            <p className="text-sm text-muted">{e.title} · {fmtDateTime(e.event_at)}{e.venue ? ` · ${e.venue}` : ""} {e.event_status !== "UPCOMING" ? <StatusBadge value="NEUTRAL" label={EVENT_STATUS_LABEL[e.event_status]} /> : null}</p>
            {e.details ? <p className="mt-2 whitespace-pre-wrap text-sm">{e.details}</p> : null}
            <ol className="mt-4 space-y-3">
              {rs.map((r) => { const st = myStatus(r); return (
                <li key={r.round_id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface p-3">
                  <div><p className="text-xs text-muted">Round {r.round_number}{r.scheduled_at ? ` · ${fmtDateTime(r.scheduled_at)}` : ""}</p><p className="font-semibold">{r.round_name}</p>
                    <div className="mt-1"><StatusBadge value={st.tone} label={st.label} /></div></div>
                  {r.token && !r.present ? <MarkButton token={r.token} /> : null}
                </li>); })}
            </ol>
          </Card>);
      })}
    </div>
  );
}

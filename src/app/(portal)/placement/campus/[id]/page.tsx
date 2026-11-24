import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EVENT_STATUS_LABEL, ROUND_STATUS_LABEL } from "@/lib/campus";
import { fmtDateTime } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getCampusEvent, roundMissing, roundRoster } from "@/server/campus/queries";
import { AddRoundForm, AttendanceLink, EventControls, ManualAdd, RoundToggle, RosterForm } from "./campus-panels";

export const metadata = { title: "On-campus drive — CampusConnect" };

export default async function CampusEventPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ round?: string; q?: string; notice?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const { id } = await params; const sp = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getCampusEvent(s, id);
  if (!data) notFound();
  const { event, rounds, stats } = data;
  const statOf = (rid: string) => stats.find((x) => x.round_id === rid);
  // The round being worked on: the one asked for, else the open one, else the latest that has people, else the first.
  const wanted = Number(sp.round);
  const current = rounds.find((r) => r.round_number === wanted) ?? rounds.find((r) => r.status === "OPEN") ?? [...rounds].reverse().find((r) => (statOf(r.id)?.present ?? 0) > 0) ?? rounds[0];
  const q = (sp.q ?? "").trim().slice(0, 80);
  const [roster, missing] = await Promise.all([roundRoster(s, current.id), roundMissing(s, current.id, q || null)]);
  const base = `/placement/campus/${id}`;
  const hasNext = rounds.some((r) => r.round_number === current.round_number + 1);
  const isLast = !hasNext;

  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/placement/campus" className="underline">← On-campus drives</Link></p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{event.company_name}</h1>
        <span className="text-muted">{event.title}</span>
        <StatusBadge value={event.status === "UPCOMING" ? "ACTIVE" : event.status} label={EVENT_STATUS_LABEL[event.status]} />
      </div>
      <p className="text-sm text-muted">{fmtDateTime(event.event_at)}{event.venue ? ` · ${event.venue}` : ""}
        {event.drive_id ? <> · <Link href={`/placement/drives/${event.drive_id}`} className="underline">posted drive: {event.drive_title}</Link> (round 1 is for its registered students)</> : " · open to the whole college"}
        {event.department_codes.length ? ` · departments: ${event.department_codes.join(", ")}` : ""}{event.passing_years.length ? ` · batches: ${event.passing_years.join(", ")}` : ""}</p>
      {sp.notice === "created" ? <Alert kind="success">Created. Open attendance for round 1 when students arrive, and share its link below.</Alert> : null}
      {event.status !== "UPCOMING" ? <Alert kind="info">This drive is {EVENT_STATUS_LABEL[event.status].toLowerCase()}, so attendance is closed. Reopen it under “Details” to continue.</Alert> : null}

      <Card title="Rounds">
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {rounds.map((r) => {
            const st = statOf(r.id); const sel = r.id === current.id;
            return (
              <li key={r.id} className={`rounded-2xl border p-4 ${sel ? "border-foreground bg-brand/20" : "border-border bg-surface"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div><p className="text-xs text-muted">Round {r.round_number}</p><p className="font-semibold">{r.name}</p>{r.scheduled_at ? <p className="text-xs text-muted">{fmtDateTime(r.scheduled_at)}</p> : null}</div>
                  <StatusBadge value={r.status === "OPEN" ? "ACTIVE" : r.status === "CLOSED" ? "CLOSED" : "PENDING"} label={ROUND_STATUS_LABEL[r.status]} />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div><dt className="text-xs text-muted">May attend</dt><dd className="text-lg font-semibold">{st?.eligible ?? 0}</dd></div>
                  <div><dt className="text-xs text-muted">Present</dt><dd className="text-lg font-semibold">{st?.present ?? 0}</dd></div>
                  <div><dt className="text-xs text-muted">Next round</dt><dd className="text-lg font-semibold">{st?.advanced ?? 0}</dd></div>
                </dl>
                {!sel ? <Link href={`${base}?round=${r.round_number}`} className="mt-3 inline-block text-sm underline">Manage this round</Link> : <p className="mt-3 text-xs font-semibold">Managing this round ↓</p>}
              </li>);
          })}
        </ol>
      </Card>

      <Card title={`Round ${current.round_number}: ${current.name}`}>
        <div className="grid gap-6 lg:grid-cols-2">
          <AttendanceLink token={current.token} id={`link-${current.id}`} />
          <div className="space-y-2">
            <p className="text-sm text-muted">Attendance is <strong>{ROUND_STATUS_LABEL[current.status].toLowerCase()}</strong>. {current.status === "OPEN" ? "Students who may attend can mark themselves present with the link." : "The link does nothing until you open attendance; opening it also notifies the students who may attend."}</p>
            {event.status === "UPCOMING" ? <RoundToggle round={current.id} status={current.status} /> : null}
          </div>
        </div>
      </Card>

      <Card title={`Who attended round ${current.round_number} (${roster.length})`}>
        <RosterForm key={current.id} round={current.id} roundNumber={current.round_number} hasNext={hasNext} rows={roster} isLast={isLast} />
      </Card>

      <Card title="Mark someone present by hand">
        <ManualAdd round={current.id} roundNumber={current.round_number} rows={missing} q={q} base={base} />
      </Card>

      <Card title="Add a round">
        <AddRoundForm id={id} next={rounds.length + 1} />
        {rounds.length >= 10 ? <p className="mt-2 text-xs text-muted">At most 10 rounds.</p> : null}
      </Card>

      <Card title="Details">
        <EventControls id={id} title={event.title} details={event.details} venue={event.venue} eventAt={event.event_at.toISOString()} status={event.status} />
      </Card>
    </div>
  );
}

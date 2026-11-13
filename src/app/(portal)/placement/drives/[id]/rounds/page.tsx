import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { isoToIstInput } from "@/lib/drives";
import { fmtDateTime } from "@/lib/format";
import { RESULT_LABEL, roundKindLabel } from "@/lib/rounds";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getDrive } from "@/server/drives/queries";
import { resultHistory, roundsWithRoster } from "@/server/rounds/queries";
import { DeleteRoundForm, ReleaseForm, ResultsForm } from "./round-panel";
import { RoundForm } from "./round-form";

export const metadata = { title: "Rounds — CampusConnect" };
const NOTICE: Record<string, string> = { "round-added": "Round added.", "round-saved": "Round saved.", "round-deleted": "Round deleted.", "results-saved": "Results saved. Students cannot see them until you release the round.", released: "Results released. Students can now see their own result." };

export default async function Rounds({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const { id } = await params; const { notice } = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getDrive(s, id);
  if (!data) notFound();
  const d = data.drive;
  const active = d.status === "PUBLISHED" || d.status === "CLOSED";
  const ended = d.status === "CLOSED" || (!!d.application_deadline && new Date(d.application_deadline) <= new Date());
  const [rounds, history] = await Promise.all([roundsWithRoster(s, id), resultHistory(s, id)]);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href={`/placement/drives/${id}`} className="underline">← {d.job_title}</Link></p>
      {notice && NOTICE[notice] ? <Alert kind="success">{NOTICE[notice]}</Alert> : null}
      <h1 className="text-2xl font-semibold tracking-tight">Rounds — {d.company_name}</h1>
      {!active ? <Alert kind="info">Rounds can be managed only for a published or closed drive.</Alert> : !ended ? <Alert kind="info">Results can be recorded after registration ends — close the drive, or wait for the application deadline ({fmtDateTime(d.application_deadline)}). You can add rounds and schedules now.</Alert> : null}
      {rounds.map((r) => {
        const released = !!r.released_at;
        const undecided = r.roster.filter((x) => x.result === "PENDING").length;
        return (
          <Card key={r.id} title={`Round ${r.round_number}: ${r.name}`}>
            <p className="flex flex-wrap items-center gap-2 text-sm"><span>{roundKindLabel(r.kind)}</span><span className="text-muted">· {r.scheduled_at ? fmtDateTime(r.scheduled_at) : "Not scheduled"}{r.venue ? ` · ${r.venue}` : ""}</span>
              <StatusBadge value={released ? "APPROVED" : "PENDING"} label={released ? "Released" : "Not released"} /></p>
            <div className="mt-4 space-y-4">
              {!released ? (
                <details className="rounded-xl border border-border p-3"><summary className="cursor-pointer text-sm font-medium">Edit schedule and details</summary>
                  <div className="mt-3"><RoundForm driveId={id} id={r.id} initial={{ name: r.name, kind: r.kind, at: isoToIstInput(r.scheduled_at), venue: r.venue ?? "", instructions: r.instructions ?? "" }} /></div></details>
              ) : null}
              <h3 className="text-sm font-semibold">Candidates</h3>
              <ResultsForm driveId={id} roundId={r.id} roster={r.roster} released={released} />
              {!released && ended && r.roster.length > 0 ? (undecided > 0 ? <p className="text-sm text-muted">{undecided} candidate(s) still have no decision. Every candidate needs one before release.</p> : <ReleaseForm driveId={id} roundId={r.id} name={r.name} />) : null}
              {!released && r.round_number === rounds.length ? <DeleteRoundForm driveId={id} roundId={r.id} /> : null}
            </div>
          </Card>
        );
      })}
      {active ? <Card title="Add a round"><RoundForm driveId={id} /></Card> : null}
      <Card title="Decision history">
        {history.length === 0 ? <p className="text-sm text-muted">No decisions recorded yet.</p> : (
          <ul className="space-y-1 text-sm" aria-label="Decision history">{history.map((h, i) => (
            <li key={i}>Round {h.round_number} · {h.full_name}: {h.from_result ? `${RESULT_LABEL[h.from_result]} → ` : ""}<span className="font-medium">{RESULT_LABEL[h.to_result]}</span>{h.note ? ` — “${h.note}”` : ""} <span className="text-muted">· {h.actor_name}, {fmtDateTime(h.occurred_at)}</span></li>
          ))}</ul>
        )}
        <p className="mt-2 text-xs text-muted">Remarks are for staff only; students never see them.</p>
      </Card>
    </div>
  );
}

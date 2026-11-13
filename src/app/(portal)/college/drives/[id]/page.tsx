import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { DriveView } from "@/components/ui/drive-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { DRIVE_STATUS_LABEL } from "@/lib/drives";
import { fmtDateTime } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { driveEvents, getDrive } from "@/server/drives/queries";
import { driveCounts } from "@/server/registrations/queries";
import { roundSummary } from "@/server/rounds/queries";
import { DriveCountsView } from "@/components/ui/drive-counts";

export const metadata = { title: "Drive — CampusConnect" };

export default async function AdminDrive({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getDrive(s, id);
  if (!data) notFound();
  const events = await driveEvents(s, id);
  const rounds = await roundSummary(s, id);
  const counts = data.drive.status === "PUBLISHED" || data.drive.status === "CLOSED" ? await driveCounts(s, id) : null;
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/college/drives" className="underline">← Drives</Link></p>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{data.drive.job_title}</h1><span className="text-muted">{data.drive.company_name}</span><StatusBadge value={data.drive.status === "PUBLISHED" ? "APPROVED" : data.drive.status === "DRAFT" ? "PENDING" : "NOT_STARTED"} label={DRIVE_STATUS_LABEL[data.drive.status]} /></div>
      {counts ? <Card title="Eligibility and registrations"><DriveCountsView c={counts} /></Card> : null}
      {rounds.length > 0 ? <Card title="Rounds"><ul className="space-y-1 text-sm" aria-label="Rounds">{rounds.map((r) => <li key={r.round_number}>Round {r.round_number}: {r.name} — {r.released_at ? "results released" : "results not released"}</li>)}</ul></Card> : null}
      <Card title="Drive details"><DriveView drive={data.drive} criteria={data.criteria} departments={data.departments} /></Card>
      <Card title="History"><ul className="space-y-1 text-sm" aria-label="Drive history">{events.map((e, i) => <li key={i}>{e.event.charAt(0) + e.event.slice(1).toLowerCase()} by {e.actor_name} <span className="text-muted">· {fmtDateTime(e.occurred_at)}</span></li>)}</ul></Card>
    </div>
  );
}

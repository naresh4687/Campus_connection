import Link from "next/link";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { DRIVE_STATUS_LABEL } from "@/lib/drives";
import { requireRole } from "@/server/auth/session";
import { linkableDrives } from "@/server/announcements/queries";

export const metadata = { title: "Drives — CampusConnect" };

export default async function CoordinatorDrives() {
  const s = await requireRole("COORDINATOR");
  const drives = await linkableDrives(s);
  return (
    <div className="space-y-6">
      <h1>Placement drives</h1>
      <p className="text-sm text-muted">Drives open to your department. Open one to see which of your students have registered and which have not, remind them, or download the list.</p>
      <Card title="Drives">
        {drives.length === 0 ? <p className="text-sm text-muted">No published drive is open to your departments yet.</p> : (
          <ul className="divide-y divide-border" aria-label="Drives">
            {drives.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span><span className="font-medium">{d.job_title}</span> <span className="text-muted">· {d.company_name}</span> <StatusBadge value={d.status === "PUBLISHED" ? "APPROVED" : "NOT_STARTED"} label={DRIVE_STATUS_LABEL[d.status]} /></span>
                <Link href={`/coordinator/drives/${d.id}`} className="underline">Registration status</Link>
              </li>))}
          </ul>)}
      </Card>
    </div>
  );
}

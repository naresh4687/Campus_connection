import { parsePage } from "@/components/ui/pagination";
import { requireRole } from "@/server/auth/session";
import { listDrives } from "@/server/drives/queries";
import { DriveList } from "../../placement/drives/drive-list";

export const metadata = { title: "Placement drives — CampusConnect" };

export default async function AdminDrives({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const page = parsePage(sp.page);
  const { rows, total, counts } = await listDrives(s, { q, status: sp.status, page });
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Placement drives</h1>
      <p className="text-sm text-muted">Read-only oversight. Placement officers create and publish drives.</p>
      <DriveList base="/college/drives" rows={rows} total={total} counts={counts} q={q} status={sp.status} page={page} />
    </div>
  );
}

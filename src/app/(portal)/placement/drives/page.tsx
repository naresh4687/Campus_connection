import Link from "next/link";
import { parsePage } from "@/components/ui/pagination";
import { requireRole } from "@/server/auth/session";
import { listDrives } from "@/server/drives/queries";
import { DriveList } from "./drive-list";

export const metadata = { title: "Placement drives — CampusConnect" };

export default async function DrivesPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const page = parsePage(sp.page);
  const { rows, total, counts } = await listDrives(s, { q, status: sp.status, page });
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Placement drives</h1>
        <Link href="/placement/drives/new" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Create drive</Link>
      </div>
      <DriveList base="/placement/drives" rows={rows} total={total} counts={counts} q={q} status={sp.status} page={page} />
    </div>
  );
}

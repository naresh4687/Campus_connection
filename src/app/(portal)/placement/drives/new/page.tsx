import Link from "next/link";
import { requireRole } from "@/server/auth/session";
import { driveFormOptions } from "@/server/drives/queries";
import { aiConfig } from "@/server/config";
import { NewDriveFlow } from "./new-drive-flow";

export const metadata = { title: "Create drive — CampusConnect" };

export default async function NewDrive({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const { company } = await searchParams;
  const { companies, departments } = await driveFormOptions(s);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/placement/drives" className="underline">← Drives</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Create a drive</h1>
      <NewDriveFlow modelOn={aiConfig().enabled} companies={companies} departments={departments} initial={{ companyName: companies.find((c) => c.id === company)?.name ?? "" }} />
    </div>
  );
}

import Link from "next/link";
import { requireRole } from "@/server/auth/session";
import { postedDrives } from "@/server/campus/queries";
import { driveFormOptions } from "@/server/drives/queries";
import { CampusForm } from "./campus-form";

export const metadata = { title: "Create on-campus drive — CampusConnect" };

export default async function NewCampusEvent() {
  const s = await requireRole("PLACEMENT_OFFICER");
  const [drives, { departments }] = await Promise.all([postedDrives(s), driveFormOptions(s)]);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/placement/campus" className="underline">← On-campus drives</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Create an on-campus drive</h1>
      <CampusForm drives={drives} departments={departments} />
    </div>
  );
}

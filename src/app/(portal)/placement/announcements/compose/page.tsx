import Link from "next/link";
import { Composer } from "@/components/announcements/composer";
import { requireRole } from "@/server/auth/session";

export const metadata = { title: "Create placement update — CampusConnect" };

export default async function Page() {
  await requireRole("PLACEMENT_OFFICER");
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/placement/announcements" className="underline">← Announcements</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Create a placement update</h1>
      <Composer canCreateDrives={true} base="/placement/announcements" />
    </div>
  );
}

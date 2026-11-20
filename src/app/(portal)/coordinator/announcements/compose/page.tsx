import Link from "next/link";
import { Composer } from "@/components/announcements/composer";
import { requireRole } from "@/server/auth/session";

export const metadata = { title: "Create placement update — CampusConnect" };

export default async function Page() {
  await requireRole("COORDINATOR");
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/coordinator/announcements" className="underline">← Announcements</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Create a placement update</h1>
      <Composer canCreateDrives={false} base="/coordinator/announcements" />
    </div>
  );
}

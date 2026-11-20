import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { MessageView } from "@/components/announcements/message-view";
import { uuidSchema } from "@/lib/validation";
import { markSeen, myAnnouncement } from "@/server/announcements/queries";
import { requireRole } from "@/server/auth/session";

export const metadata = { title: "Announcement — CampusConnect" };

export default async function StudentAnnouncement({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("STUDENT");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const a = await myAnnouncement(s, id);
  if (!a) notFound();
  if (!a.seen_at) await markSeen(s, id);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/student/announcements" className="underline">← Announcements</Link></p>
      <Card><MessageView a={a} /></Card>
    </div>
  );
}

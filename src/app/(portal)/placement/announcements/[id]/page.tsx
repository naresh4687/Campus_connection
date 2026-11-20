import { AnnouncementEdit } from "@/components/announcements/staff-pages";

export const metadata = { title: "Announcement — CampusConnect" };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; published?: string; composed?: string }> }) {
  const { id } = await params;
  return <AnnouncementEdit role="PLACEMENT_OFFICER" id={id} flags={await searchParams} />;
}

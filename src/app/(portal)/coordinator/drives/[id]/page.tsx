import { ParticipationView } from "@/components/participation/participation-view";

export const metadata = { title: "Registration status — CampusConnect" };
export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string; who?: string; dept?: string }> }) {
  return <ParticipationView role="COORDINATOR" id={(await params).id} sp={await searchParams} />;
}

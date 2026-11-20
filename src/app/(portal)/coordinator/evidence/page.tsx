import { EvidenceInbox } from "@/components/evidence/inbox";

export const metadata = { title: "Registration screenshots — CampusConnect" };
export default async function Page({ searchParams }: { searchParams: Promise<{ all?: string; decided?: string }> }) {
  const sp = await searchParams;
  return <EvidenceInbox role="COORDINATOR" all={sp.all === "1"} decided={sp.decided} />;
}

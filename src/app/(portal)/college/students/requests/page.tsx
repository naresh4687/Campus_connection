import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { RequestList } from "@/components/join/request-list";
import { requireRole } from "@/server/auth/session";
import { joinRequests } from "@/server/join/queries";

export const metadata = { title: "Sign-up requests — CampusConnect" };

export default async function AdminRequests({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const { notice } = await searchParams;
  const rows = await joinRequests(s);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/college/students" className="underline">← Students</Link></p>
      {notice === "approved" ? <Alert kind="success">Approved. The student can sign in now.</Alert> : notice === "rejected" ? <Alert kind="success">Rejected.</Alert> : null}
      <h1 className="text-2xl font-semibold tracking-tight">Student sign-up requests</h1>
      <Card><RequestList rows={rows} /></Card>
    </div>
  );
}

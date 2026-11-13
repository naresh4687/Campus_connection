import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { RequestList } from "@/components/join/request-list";
import { requireRole } from "@/server/auth/session";
import { joinRequests } from "@/server/join/queries";

export const metadata = { title: "Sign-up requests — CampusConnect" };

export default async function CoordinatorRequests({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const s = await requireRole("COORDINATOR");
  const { notice } = await searchParams;
  const rows = await joinRequests(s);      // row-level security returns only the departments assigned to this coordinator
  return (
    <div className="space-y-6">
      {notice === "approved" ? <Alert kind="success">Approved. The student can sign in now.</Alert> : notice === "rejected" ? <Alert kind="success">Rejected.</Alert> : null}
      <h1 className="text-2xl font-semibold tracking-tight">Student sign-up requests</h1>
      <p className="text-sm text-muted">Students of your departments who asked for an account through the college’s sign-up link. Check that the person is really your student before approving.</p>
      <Card><RequestList rows={rows} /></Card>
    </div>
  );
}

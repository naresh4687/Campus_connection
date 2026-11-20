import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDateTime } from "@/lib/format";
import { requireSession } from "@/server/auth/session";
import { myPasswordRequest, pendingRequests } from "@/server/auth/password-requests-queries";
import { PasswordForm } from "./password-form";
import { ProfileForm } from "./profile-form";
import { RequestPasswordButton } from "./request-button";

export const metadata = { title: "Account — CampusConnect" };
const ABOVE: Record<string, string> = { STUDENT: "your department coordinator and the placement staff", COORDINATOR: "your college administrator", PLACEMENT_OFFICER: "your college administrator", COLLEGE_ADMIN: "the platform administrator" };

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const session = await requireSession();
  const { notice } = await searchParams;
  const platform = session.role === "PLATFORM_SUPER_ADMIN";
  const [req, waiting] = await Promise.all([platform ? null : myPasswordRequest(session), pendingRequests(session)]);
  return (
    <div className="space-y-6">
      <h1>Account</h1>
      {notice === "password-changed" ? <Alert kind="success">Your password was changed. Your other sessions were signed out.</Alert> : null}
      {waiting.length > 0 ? <Alert kind="info"><Link href="/account/password-requests" className="font-semibold underline">{waiting.length} password request{waiting.length === 1 ? " is" : "s are"} waiting for your approval</Link></Alert> : null}
      <Card title="Name and email"><ProfileForm name={session.fullName} email={session.email} /></Card>
      <Card title="Password">
        {platform ? <PasswordForm /> : (
          <div className="space-y-3 text-sm">
            <p className="text-muted">A password change needs approval from {ABOVE[session.role] ?? "the people above you"}. Ask here, and you will be notified when it is approved. Then you choose the new password yourself.</p>
            {req?.status === "PENDING" ? <p>Request sent {fmtDateTime(req.requested_at)}. <StatusBadge value="PENDING" label="Waiting for approval" /></p> : null}
            {req?.status === "APPROVED" ? <p><StatusBadge value="APPROVED" label="Approved" /> by {req.decided_by_name}. <Link href={`/account/password/${req.id}`} className="font-semibold underline">Choose your new password</Link></p> : null}
            {req?.status === "DENIED" ? <p><StatusBadge value="REJECTED" label="Declined" /> Your last request was declined.</p> : null}
            {req?.status === "EXPIRED" ? <p><StatusBadge value="NOT_STARTED" label="Expired" /> The approval expired before it was used.</p> : null}
            {!req || ["DENIED", "EXPIRED", "USED"].includes(req.status) ? <RequestPasswordButton /> : null}
          </div>)}
      </Card>
    </div>
  );
}

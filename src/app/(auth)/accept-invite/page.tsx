import Link from "next/link";
import { sql } from "kysely";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert } from "@/components/ui/alert";
import { db } from "@/server/db";
import { getSession } from "@/server/auth/session";
import { hashToken, isWellFormedToken } from "@/server/auth/tokens";
import { AcceptForm } from "./accept-form";

export const metadata = { title: "Accept invitation — CampusConnect" };

const ROLE_LABEL: Record<string, string> = {
  COLLEGE_ADMIN: "college administrator",
  PLACEMENT_OFFICER: "placement officer",
  COORDINATOR: "department coordinator",
  STUDENT: "student",
};

export default async function AcceptInvitePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const current = await getSession();
  const invite = isWellFormedToken(token)
    ? (await sql<{ email: string; role: string; college_name: string }>`SELECT * FROM auth.peek_invitation(${hashToken(token)})`.execute(db())).rows[0]
    : undefined;

  const department = invite && isWellFormedToken(token) ? (await sql<{ d: string | null }>`SELECT auth.peek_invitation_department(${hashToken(token)}) AS d`.execute(db())).rows[0]?.d : null;
  return (
    <AuthShell title="Accept your invitation">
      {invite && isWellFormedToken(token) ? (
        <div className="space-y-4">
          <p className="text-sm">
            You were invited to join <strong>{invite.college_name}</strong> as a {ROLE_LABEL[invite.role] ?? "member"}{department ? <> for the <strong>{department}</strong> department</> : null} using{" "}
            <strong>{invite.email}</strong>.
          </p>
          {current ? <Alert kind="info">This browser is currently signed in as {current.fullName}. Creating this account will sign that account out.</Alert> : null}
          <AcceptForm token={token} />
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <Alert kind="error">This invitation link is invalid, already used, or has expired.</Alert>
          <p>Ask your administrator to send a new invitation.</p>
          <p className="text-center"><Link href="/login" className="underline">Go to sign in</Link></p>
        </div>
      )}
    </AuthShell>
  );
}

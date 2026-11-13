import Link from "next/link";
import { sql } from "kysely";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert } from "@/components/ui/alert";
import { db } from "@/server/db";
import { hashToken, isWellFormedToken } from "@/server/auth/tokens";
import { ResetForm } from "./reset-form";

export const metadata = { title: "Reset password — CampusConnect" };

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  const found = isWellFormedToken(token)
    ? (await sql<{ email: string }>`SELECT * FROM auth.peek_password_reset(${hashToken(token)})`.execute(db())).rows[0]
    : undefined;

  return (
    <AuthShell title="Reset your password">
      {found && isWellFormedToken(token) ? (
        <div className="space-y-4">
          <p className="text-sm">Choose a new password for <strong>{found.email}</strong>. All your sessions will be signed out.</p>
          <ResetForm token={token} />
        </div>
      ) : (
        <div className="space-y-4 text-sm">
          <Alert kind="error">This reset link is invalid, already used, or has expired.</Alert>
          <p>Ask your administrator to issue a new one.</p>
          <p className="text-center"><Link href="/login" className="underline">Go to sign in</Link></p>
        </div>
      )}
    </AuthShell>
  );
}

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { uuidSchema } from "@/lib/validation";
import { myPasswordRequest } from "@/server/auth/password-requests-queries";
import { requireSession } from "@/server/auth/session";
import { PasswordSetForm } from "./password-set-form";

export const metadata = { title: "Choose a new password — CampusConnect" };

export default async function SetPassword({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireSession();
  const { id } = await params;
  const mine = uuidSchema.safeParse(id).success ? await myPasswordRequest(s) : null;
  const ok = mine && mine.id === id && mine.status === "APPROVED";
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/account" className="underline">← Account</Link></p>
      <h1>Choose a new password</h1>
      {ok ? <Card title="New password"><p className="mb-4 text-sm text-muted">Approved by {mine.decided_by_name}. This approval works once and stays valid for 24 hours.</p><PasswordSetForm id={id} /></Card>
        : <Alert kind="info">This approval is not available. It may have been used, declined or have expired. You can ask for a new password change from your account page.</Alert>}
    </div>
  );
}

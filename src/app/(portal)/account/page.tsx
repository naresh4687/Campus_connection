import { Card } from "@/components/ui/card";
import { requireSession } from "@/server/auth/session";
import { PasswordForm } from "./password-form";

export const metadata = { title: "Account — CampusConnect" };

export default async function AccountPage() {
  const session = await requireSession();
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <Card title="Profile">
        <dl className="grid grid-cols-[8rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Name</dt><dd>{session.fullName}</dd>
          <dt className="text-muted">Email</dt><dd>{session.email}</dd>
        </dl>
      </Card>
      <Card title="Change password"><PasswordForm /></Card>
    </div>
  );
}

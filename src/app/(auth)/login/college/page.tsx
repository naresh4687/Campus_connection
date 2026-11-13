import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert } from "@/components/ui/alert";
import { HOME_PATH, getSession } from "@/server/auth/session";
import { LoginForm } from "../login-form";

export const metadata = { title: "College sign in — CampusConnect" };

export default async function Page({ searchParams }: { searchParams: Promise<{ welcome?: string; reset?: string }> }) {
  const session = await getSession();
  const sp = await searchParams;
  if (session && !sp.welcome && !sp.reset) redirect(HOME_PATH[session.role]);
  return (
    <AuthShell title="College sign in">
      <div className="space-y-4">
        {sp.welcome ? <Alert kind="success">Your account is ready. Sign in to continue.</Alert> : null}
        {sp.reset ? <Alert kind="success">Your password was changed. Sign in with the new password.</Alert> : null}
        <p className="text-sm text-muted">For administrators, placement officers, coordinators and platform administrators.</p>
        <LoginForm />
        <p className="text-center text-sm"><Link href="/forgot-password" className="underline">Forgot your password?</Link></p>
        <p className="text-center text-sm text-muted"><Link href="/login/student" className="underline">Student? Sign in here</Link> · <Link href="/login" className="underline">Back</Link></p>
      </div>
    </AuthShell>
  );
}

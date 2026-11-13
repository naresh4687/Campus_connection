import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Forgot password — CampusConnect" };

export default function ForgotPasswordPage() {
  return (
    <AuthShell title="Forgot your password?">
      <div className="space-y-4 text-sm">
        <Alert>Email delivery is not enabled in this deployment, so no reset email can be sent.</Alert>
        <p>
          Ask your college administrator to issue a one-time password reset link for your account. College
          administrators should contact the CampusConnect platform administrator.
        </p>
        <p>The link works once and expires after a short time.</p>
        <p className="text-center"><Link href="/login" className="underline">Back to sign in</Link></p>
      </div>
    </AuthShell>
  );
}

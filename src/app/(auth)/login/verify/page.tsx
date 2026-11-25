import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { VerifyForm } from "./verify-form";

export const metadata = { title: "Two-step sign-in — CampusConnect" };

export default function VerifyPage() {
  return (
    <AuthShell title="Enter your code">
      <div className="space-y-4">
        <VerifyForm />
        <p className="text-sm text-muted">Lost your phone and your recovery codes? Ask your administrator to remove two-step sign-in for your account.</p>
        <p className="text-center text-sm"><Link href="/login" className="underline">Start again</Link></p>
      </div>
    </AuthShell>
  );
}

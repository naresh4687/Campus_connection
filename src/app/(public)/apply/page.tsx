import Link from "next/link";
import { ApplyForm } from "./apply-form";

export const metadata = { title: "Apply as a college — CampusConnect" };

export default function ApplyPage() {
  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-14">
      <h1 className="text-3xl font-semibold tracking-tight">Apply as a college</h1>
      <p className="mt-3 text-muted">
        Tell us about your institution. The CampusConnect team reviews every application. After you submit you get a private link to
        check its status. We do not send automatic emails yet, so keep that link. See <Link href="/how-it-works" className="underline">how onboarding works</Link>.
      </p>
      <div className="mt-8 rounded-2xl border border-border bg-surface p-6 shadow-soft">
        <ApplyForm />
      </div>
      <p className="mt-4 text-xs text-muted">By applying you agree that we may use these details to review your application and contact you. See the <Link href="/privacy" className="underline">privacy policy</Link>.</p>
    </main>
  );
}

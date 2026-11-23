import Link from "next/link";
import { ApplyForm } from "./apply-form";

export const metadata = { title: "Apply as a college — CampusConnect" };

export default function ApplyPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-14 sm:py-20">
      <h1 className="display text-[clamp(2.4rem,7vw,4rem)]">Apply as a college</h1>
      <p className="mt-5 text-lg text-muted">
        Tell us about your institution. The CampusConnect team reviews every application. After you submit you get a private link to
        check its status. Keep that link: it is how you follow your application. See <Link href="/how-it-works" className="font-medium text-foreground underline underline-offset-4">how onboarding works</Link>.
      </p>
      <div className="mt-8 rounded-[1.75rem] border border-border bg-surface p-6 sm:p-8">
        <ApplyForm />
      </div>
      <p className="mt-4 text-xs text-muted">By applying you agree that we may use these details to review your application and contact you. See the <Link href="/privacy" className="underline">privacy policy</Link>.</p>
    </main>
  );
}

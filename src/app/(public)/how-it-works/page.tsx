import Link from "next/link";
import { ONBOARDING_STEPS, PLACEMENT_FLOW } from "@/lib/site-content";

export const metadata = { title: "How it works — CampusConnect" };

export default function HowItWorksPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-14">
      <h1 className="text-3xl font-semibold tracking-tight">How it works</h1>

      <h2 className="mt-10 text-xl font-semibold">Getting your college onto CampusConnect</h2>
      <ol className="mt-5 space-y-4">
        {ONBOARDING_STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{i + 1}</span>
            <span><span className="block font-medium">{s.title}</span><span className="text-sm text-muted">{s.text}</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-sm text-muted">Subscription billing is not part of this early-access phase; commercial arrangements are recorded manually by the platform team.</p>

      <h2 className="mt-12 text-xl font-semibold">The placement workflow the platform is built around</h2>
      <p className="mt-1 text-sm text-muted">Some of these steps are still in development — see <Link href="/features" className="underline">Features</Link> for what is available today.</p>
      <ol className="mt-5 space-y-4">
        {PLACEMENT_FLOW.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border text-sm font-semibold">{i + 1}</span>
            <span><span className="block font-medium">{s.title}</span><span className="text-sm text-muted">{s.text}</span></span>
          </li>
        ))}
      </ol>
      <p className="mt-10"><Link href="/apply" className="inline-flex h-11 items-center rounded-md bg-primary px-5 font-medium text-primary-foreground">Apply as a college</Link></p>
    </main>
  );
}

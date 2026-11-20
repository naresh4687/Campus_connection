import Link from "next/link";
import { buttonClass } from "@/components/ui/button";
import { ONBOARDING_STEPS, PLACEMENT_FLOW } from "@/lib/site-content";

export const metadata = { title: "How it works — CampusConnect" };

function Steps({ steps }: { steps: readonly { title: string; text: string }[] }) {
  return (
    <ol className="border-t border-border">
      {steps.map((s, i) => (
        <li key={s.title} className="grid grid-cols-[3.5rem_1fr] gap-4 border-b border-border py-5 sm:grid-cols-[5rem_1fr]">
          <span className="display text-3xl tabular-nums sm:text-4xl">{String(i + 1).padStart(2, "0")}</span>
          <span><span className="block text-lg font-semibold">{s.title}</span><span className="mt-1 block text-muted">{s.text}</span></span>
        </li>
      ))}
    </ol>
  );
}

export default function HowItWorksPage() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-14 sm:py-20">
      <h1 className="display text-[clamp(2.4rem,7vw,4rem)]">How it works</h1>

      <section className="mt-14 grid gap-6 lg:grid-cols-[18rem_1fr] lg:gap-12">
        <div>
          <h2 className="text-2xl">Getting your college onto CampusConnect</h2>
          <p className="mt-3 text-sm text-muted">Subscription billing is not part of this early-access phase; commercial arrangements are recorded manually by the platform team.</p>
        </div>
        <Steps steps={ONBOARDING_STEPS} />
      </section>

      <section className="mt-16 grid gap-6 lg:grid-cols-[18rem_1fr] lg:gap-12">
        <div>
          <h2 className="text-2xl">The placement workflow the platform is built around</h2>
          <p className="mt-3 text-sm text-muted">Some of these steps are still in development — see <Link href="/features" className="font-medium text-foreground underline underline-offset-4">Features</Link> for what is available today.</p>
        </div>
        <Steps steps={PLACEMENT_FLOW} />
      </section>

      <p className="mt-14"><Link href="/apply" className={buttonClass("primary", "h-12 px-6 text-base")}>Apply as a college</Link></p>
    </main>
  );
}

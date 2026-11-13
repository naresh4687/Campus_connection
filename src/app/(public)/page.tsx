import Link from "next/link";
import { redirect } from "next/navigation";
import { PLACEMENT_FLOW } from "@/lib/site-content";
import { HOME_PATH, getSession } from "@/server/auth/session";

export default async function Home() {
  const session = await getSession();
  if (session) redirect(HOME_PATH[session.role]);
  return (
    <main>
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="drift pointer-events-none absolute -right-28 -top-24 h-96 w-96 rounded-full bg-accent/25 blur-3xl" />
        <div aria-hidden="true" className="drift pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-primary/15 blur-3xl [animation-delay:-8s]" />
        <div className="relative mx-auto w-full max-w-5xl px-4 py-16 sm:py-24">
        <p className="rise inline-block rounded-full bg-tint px-3 py-1 text-sm font-semibold text-primary">Placement management for engineering colleges</p>
        <h1 className="rise mt-4 max-w-3xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl [--i:1]">
          One place for the whole <span className="text-primary">campus placement process</span>
        </h1>
        <p className="rise mt-5 max-w-2xl text-lg text-muted [--i:2]">
          Many colleges run placements through spreadsheets, forms, email and WhatsApp groups. Records get scattered, eligibility is
          checked by hand, and nobody can say for sure who was selected, who got an offer and who actually joined.
          CampusConnect brings students, academic verification, companies, drives, eligibility, rounds, offers and placement records into
          one system, with a separate workspace for every college.
        </p>
        <div className="rise mt-8 flex flex-wrap gap-3 [--i:3]">
          <Link href="/apply" className="inline-flex h-12 items-center rounded-xl bg-primary px-6 font-semibold text-primary-foreground shadow-[0_8px_20px_-10px_var(--primary)] transition hover:-translate-y-px">Apply as a college</Link>
          <Link href="/login" className="inline-flex h-12 items-center rounded-xl border border-border bg-surface px-6 font-semibold transition-colors hover:bg-tint">Sign in</Link>
        </div>
        <p className="mt-4 text-sm text-muted">Early access: colleges are onboarded by application, and some modules are still being built. <Link href="/features" className="underline">See what is available today</Link>.</p>
        </div>
      </section>

      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-5xl px-4 py-14">
          <h2 className="text-3xl font-bold tracking-tight">From student record to verified placement</h2>
          <ol className="mt-8 grid gap-5 sm:grid-cols-2">
            {PLACEMENT_FLOW.map((s, i) => (
              <li key={s.title} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
                <span><span className="block font-medium">{s.title}</span><span className="text-sm text-muted">{s.text}</span></span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 py-14">
        <h2 className="text-3xl font-bold tracking-tight">Built around trust</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-3">
          <li className="lift rounded-2xl border border-border bg-surface p-6"><p className="font-medium">Your data stays yours</p><p className="mt-1 text-sm text-muted">Each college has its own workspace. One college cannot see another&apos;s records; the database enforces it.</p></li>
          <li className="lift rounded-2xl border border-border bg-surface p-6"><p className="font-medium">Rules, not guesses</p><p className="mt-1 text-sm text-muted">Academic eligibility is decided by a deterministic engine using verified records. AI never decides eligibility.</p></li>
          <li className="lift rounded-2xl border border-border bg-surface p-6"><p className="font-medium">Honest numbers</p><p className="mt-1 text-sm text-muted">An accepted offer is not counted as a placement until joining is verified with evidence.</p></li>
        </ul>
      </section>
    </main>
  );
}

import Link from "next/link";
import { redirect } from "next/navigation";
import { HOME_PATH, getSession } from "@/server/auth/session";

const BENEFITS = [
  { title: "One record for every placement", text: "Students, verified academics, companies, drives, rounds and offers live together, so nobody has to rebuild the picture from spreadsheets and chat groups." },
  { title: "Rules, not guesses", text: "Eligibility is decided by a clear rule engine using verified records, and it explains the result. AI never decides who is eligible." },
  { title: "Numbers you can defend", text: "An accepted offer only counts as a placement once joining is verified with evidence. Reports come from the real records." },
];

const STEPS = [
  { title: "Set up your college", text: "Add departments, invite staff and bring in students from a CSV file." },
  { title: "Verify academics", text: "Students submit marks. Department coordinators verify them or send them back with a reason." },
  { title: "Run drives", text: "Publish a drive with its criteria. Eligible students are told and can register." },
  { title: "Confirm placements", text: "Track rounds, offers and joining, and report only what is verified." },
];

const ROLES = [
  { who: "Placement officers", what: "Create drives, run rounds, record offers and export reports." },
  { who: "Department coordinators", what: "Verify student records and keep their department's roster in order." },
  { who: "Students", what: "See the drives they are eligible for, register in a click and follow their results." },
  { who: "College administrators", what: "Set up departments and staff, and see the whole college at a glance." },
];

const TRUST = [
  { title: "Your data stays yours", text: "Each college has its own workspace, and the database itself stops one college from seeing another's records." },
  { title: "Private documents", text: "Résumés, mark sheets and offer letters sit in private storage and open only through short-lived links." },
  { title: "A record of who did what", text: "Sensitive actions are written to an append-only audit trail." },
];

const FAQ = [
  { q: "Is CampusConnect ready for my college?", a: "It is in early access. Colleges join by application, and the platform team reviews each one. The features page lists exactly what works today and what does not yet." },
  { q: "Does AI decide which students are eligible?", a: "No. Eligibility comes from a fixed rule engine and verified academic records. An optional assistant can help read a company announcement, and an officer checks every field before anything is saved." },
  { q: "Will students and staff get emails?", a: "Not yet. Notifications appear inside CampusConnect, and your administrator shares invitation and reset links directly." },
];

export default async function Home() {
  const session = await getSession();
  if (session) redirect(HOME_PATH[session.role]);
  const cta = "inline-flex h-12 items-center rounded-xl px-6 font-semibold transition hover:-translate-y-px";
  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden="true" className="drift pointer-events-none absolute -right-28 -top-24 h-96 w-96 rounded-full bg-accent/25 blur-3xl" />
        <div aria-hidden="true" className="drift pointer-events-none absolute -bottom-32 -left-24 h-96 w-96 rounded-full bg-primary/15 blur-3xl [animation-delay:-8s]" />
        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:py-24 lg:grid-cols-[1.1fr_0.9fr]">
          <div>
            <p className="rise inline-block rounded-full bg-tint px-3 py-1 text-sm font-semibold text-primary">Placement management for engineering colleges</p>
            <h1 className="rise mt-4 text-4xl font-bold leading-[1.08] tracking-tight sm:text-6xl [--i:1]">
              One place for the whole <span className="text-primary">campus placement process</span>
            </h1>
            <p className="rise mt-5 max-w-xl text-lg text-muted [--i:2]">
              From student records to verified placements, CampusConnect replaces the spreadsheets, forms and group chats with one organised system for your college.
            </p>
            <div className="rise mt-8 flex flex-wrap gap-3 [--i:3]">
              <Link href="/apply" className={`${cta} bg-primary text-primary-foreground shadow-[0_8px_20px_-10px_var(--primary)]`}>Apply as a college</Link>
              <Link href="/how-it-works" className={`${cta} border border-border bg-surface hover:bg-tint`}>See how it works</Link>
            </div>
            <p className="rise mt-4 text-sm text-muted [--i:4]">Early access: colleges are onboarded by application. <Link href="/features" className="underline">See what is available today</Link>.</p>
          </div>

          {/* Illustration only: shows the kind of screen, not real data. */}
          <div className="rise relative mx-auto w-full max-w-md [--i:3]" aria-hidden="true">
            <div className="rounded-3xl border border-border bg-surface p-5 shadow-soft">
              <div className="flex items-center justify-between">
                <p className="font-display text-lg font-bold">Software Engineer</p>
                <span className="rounded-full border border-success/40 px-2.5 py-0.5 text-xs font-medium text-success">Open</span>
              </div>
              <p className="mt-1 text-sm text-muted">Example drive · Registration open</p>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                {["Eligible", "Needs data", "Registered"].map((k) => (
                  <div key={k} className="rounded-xl bg-tint px-2 py-3"><div className="mx-auto h-2 w-8 rounded-full bg-primary/40" /><p className="mt-2 text-muted">{k}</p></div>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {["Round 1 · Aptitude", "Round 2 · Technical", "Round 3 · HR"].map((r, i) => (
                  <div key={r} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2 text-sm"><span className={`h-2.5 w-2.5 rounded-full ${i === 0 ? "bg-success" : "bg-border"}`} />{r}</div>
                ))}
              </div>
            </div>
            <div className="lift absolute -bottom-6 -left-4 hidden rounded-2xl border border-border bg-surface px-4 py-3 text-sm shadow-soft sm:block">
              <p className="font-semibold">Offer verified</p><p className="text-xs text-muted">Joining confirmed with evidence</p>
            </div>
            <p className="mt-8 text-center text-xs text-muted">Illustration of a drive screen</p>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-16">
          <h2 className="max-w-2xl text-3xl font-bold tracking-tight">Everything your placement cell does, kept in order</h2>
          <ul className="mt-10 grid gap-5 md:grid-cols-3">
            {BENEFITS.map((b) => (
              <li key={b.title} className="lift rounded-2xl border border-border bg-background p-6">
                <span aria-hidden="true" className="mb-4 block h-1.5 w-10 rounded-full bg-linear-to-r from-primary to-accent" />
                <p className="font-display text-lg font-bold">{b.title}</p>
                <p className="mt-2 text-sm text-muted">{b.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-3xl font-bold tracking-tight">From first login to verified placement</h2>
          <Link href="/how-it-works" className="text-sm font-semibold text-primary underline">The full flow</Link>
        </div>
        <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="rounded-2xl border border-border bg-surface p-6 shadow-soft">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-sm font-bold text-primary-foreground">{i + 1}</span>
              <p className="mt-4 font-display text-lg font-bold">{s.title}</p>
              <p className="mt-1 text-sm text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Roles */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-16">
          <h2 className="text-3xl font-bold tracking-tight">A clear place for everyone</h2>
          <p className="mt-3 max-w-2xl text-muted">Each person signs in and sees only what their role needs.</p>
          <dl className="mt-10 grid gap-5 sm:grid-cols-2">
            {ROLES.map((r) => (
              <div key={r.who} className="rounded-2xl bg-tint p-6"><dt className="font-display text-lg font-bold">{r.who}</dt><dd className="mt-1 text-sm text-muted">{r.what}</dd></div>
            ))}
          </dl>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16">
        <h2 className="text-3xl font-bold tracking-tight">Built around trust</h2>
        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {TRUST.map((t) => (
            <li key={t.title} className="lift rounded-2xl border border-border bg-surface p-6"><p className="font-display text-lg font-bold">{t.title}</p><p className="mt-2 text-sm text-muted">{t.text}</p></li>
          ))}
        </ul>
      </section>

      {/* FAQ */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-3xl px-4 py-16">
          <h2 className="text-3xl font-bold tracking-tight">Questions colleges ask</h2>
          <div className="mt-8 divide-y divide-border rounded-2xl border border-border">
            {FAQ.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                  {f.q}<span aria-hidden="true" className="text-primary transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="mt-3 text-sm text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Closing call to action */}
      <section className="px-4 pb-16 pt-4">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-nav px-6 py-14 text-center text-nav-foreground sm:px-12">
          <div aria-hidden="true" className="drift pointer-events-none absolute -right-16 -top-16 h-64 w-64 rounded-full bg-accent/40 blur-3xl" />
          <div className="relative">
            <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-4xl">Bring your college onto CampusConnect</h2>
            <p className="mx-auto mt-3 max-w-xl">Tell us about your college. We review each application and set up a private workspace if it is approved.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link href="/apply" className={`${cta} bg-white text-black`}>Apply as a college</Link>
              <Link href="/login" className={`${cta} border border-white/40 text-white hover:bg-white/10`}>Sign in</Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

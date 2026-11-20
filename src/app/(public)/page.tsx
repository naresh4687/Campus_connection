import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

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

// The hero illustration: an example drive, not real data.
const EXAMPLE = [
  { roll: "21CS014", name: "Priya R.", cgpa: "8.4", verdict: "Eligible", tone: "ok" },
  { roll: "21CS022", name: "Arjun K.", cgpa: "6.7", verdict: "Not eligible", tone: "no" },
  { roll: "21EC031", name: "Meena S.", cgpa: "—", verdict: "Needs data", tone: "wait" },
  { roll: "21ME008", name: "Rahul V.", cgpa: "7.9", verdict: "Eligible", tone: "ok" },
] as const;
const VERDICT = { ok: "bg-brand text-brand-foreground", no: "bg-[#ff7a5c] text-[#101210]", wait: "border border-[#f2b54a] text-[#f2b54a]" } as const;
const STAGGER = ["[--i:0]", "[--i:1]", "[--i:2]", "[--i:3]"];

const PIPELINE = "Drive\u2003Rounds\u2003Offer\u2003Joining\u2003";

function Chevrons() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 12" className="chevrons h-3 w-6">
      {[0, 7, 14].map((x, i) => <path key={x} d={`M${x + 2} 1.5 L${x + 6.5} 6 L${x + 2} 10.5`} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" strokeOpacity={0.4 + i * 0.3} />)}
    </svg>
  );
}

export default function Home() {
  return (
    <main>
      {/* Hero */}
      <section className="overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-16 pt-12 sm:pt-20 lg:grid-cols-[minmax(0,1fr)_29rem] lg:pb-24">
          <div>
            <h1 className="display rise text-[clamp(2.5rem,8.4vw,4.5rem)] lg:text-[clamp(3rem,5.3vw,4.25rem)]">Every placement, on record.</h1>
            <p className="rise mt-6 max-w-[34rem] text-lg leading-relaxed text-muted [--i:1]">
              CampusConnect runs your college&apos;s placement drives from eligibility to verified joining, in one system instead of spreadsheets, forms and group chats.
            </p>
            <div className="rise mt-9 flex flex-wrap items-center gap-3 [--i:2]">
              <Link href="/apply" className={buttonClass("primary", "h-13 pl-6 pr-5 text-base")}>Apply as a college <Chevrons /></Link>
              <Link href="/how-it-works" className={buttonClass("secondary", "h-13 px-6 text-base")}>See how it works</Link>
            </div>
            <p className="rise mt-5 text-sm text-muted [--i:3]">Early access: colleges join by application. <Link href="/features" className="font-medium text-foreground underline underline-offset-4">See what works today</Link>.</p>
          </div>

          {/* Illustration only: an example drive, not real data. */}
          <div className="rise relative mx-auto w-full max-w-[29rem] [--i:2]" aria-hidden="true">
            <div className="rounded-[2rem] bg-brand p-5 pb-16 text-brand-foreground sm:p-6 sm:pb-16">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm font-medium">Example drive</p>
                  <p className="display mt-1 text-2xl">Software engineer</p>
                  <p className="mt-1 text-sm">Minimum CGPA 7.0, no active backlogs</p>
                </div>
                <span className="rounded-full bg-brand-foreground px-3 py-1 text-xs font-semibold text-brand">Open</span>
              </div>
              <div className="mt-5 overflow-hidden rounded-2xl bg-[#101210] text-[#eef3e8]">
                <div className="grid grid-cols-[minmax(0,1fr)_2.25rem_6rem] sm:grid-cols-[4.25rem_minmax(0,1fr)_2.25rem_6rem] gap-2 border-b border-white/10 px-4 py-2.5 text-xs text-[#a0a996]">
                  <span className="hidden sm:block">Roll no.</span><span>Student</span><span className="text-right">CGPA</span><span className="text-right">Verdict</span>
                </div>
                {EXAMPLE.map((r, i) => (
                  <div key={r.roll} className="grid grid-cols-[minmax(0,1fr)_2.25rem_6rem] sm:grid-cols-[4.25rem_minmax(0,1fr)_2.25rem_6rem] items-center gap-2 border-b border-white/10 px-4 py-3 text-sm tabular-nums last:border-b-0">
                    <span className="hidden text-[#a0a996] sm:block">{r.roll}</span>
                    <span className="truncate font-medium">{r.name}</span>
                    <span className="text-right">{r.cgpa}</span>
                    <span className="text-right"><span className={`stamp inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${VERDICT[r.tone]} ${STAGGER[i]}`}>{r.verdict}</span></span>
                  </div>
                ))}
              </div>
              <div className="mt-5 flex items-end justify-between">
                <div>
                  <p className="text-sm font-medium">Eligible so far</p>
                  <p className="display text-5xl">2<span className="text-2xl">/4</span></p>
                </div>
                <p className="max-w-[10rem] text-right text-xs">Checked against verified marks, with the reason for every result.</p>
              </div>
            </div>
            <div className="display absolute bottom-3 -left-6 -right-6 -rotate-[4deg] overflow-hidden whitespace-nowrap bg-nav py-2 text-sm text-brand">
              Offer verified &nbsp;&nbsp; Joining confirmed &nbsp;&nbsp; Offer verified &nbsp;&nbsp; Joining confirmed &nbsp;&nbsp; Offer verified
            </div>
          </div>
        </div>
      </section>

      {/* The pipeline in outlined capitals (decorative; the steps below say the same in plain text). */}
      <div aria-hidden="true" className="overflow-hidden bg-nav py-6 text-[clamp(2rem,6vw,4.5rem)]">
        {[0, 1, 2].map((row) => (
          <p key={row} className={`display whitespace-nowrap leading-[1.05] ${row === 1 ? "text-brand" : "type-outline [-webkit-text-stroke-color:#66735a]"} ${row === 1 ? "-ml-24" : row === 2 ? "-ml-48" : ""}`}>
            {PIPELINE.repeat(4)}
          </p>
        ))}
      </div>

      {/* How a drive runs: a real sequence, so it is numbered. */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="display max-w-2xl text-[clamp(1.9rem,4vw,3rem)]">From first login to verified placement</h2>
          <Link href="/how-it-works" className="text-sm font-semibold underline underline-offset-4">The full flow</Link>
        </div>
        <ol className="mt-12 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="border-t-2 border-foreground pt-5">
              <span className="display text-4xl tabular-nums">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="mt-4 text-lg">{s.title}</h3>
              <p className="mt-2 text-muted">{s.text}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* What it handles */}
      <section className="border-y border-border bg-surface">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 lg:grid-cols-[0.8fr_1.2fr]">
          <h2 className="display text-[clamp(1.9rem,3.1vw,2.6rem)]">Everything your placement cell does, kept in order</h2>
          <ul className="divide-y divide-border border-y border-border">
            {BENEFITS.map((b) => (
              <li key={b.title} className="grid gap-2 py-6 sm:grid-cols-[14rem_1fr] sm:gap-8">
                <h3 className="text-lg">{b.title}</h3>
                <p className="text-muted">{b.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Roles */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20">
        <h2 className="display text-[clamp(1.9rem,4vw,3rem)]">A clear place for everyone</h2>
        <p className="mt-4 max-w-xl text-lg text-muted">Each person signs in and sees only what their role needs.</p>
        <dl className="mt-10 grid border-t border-border sm:grid-cols-2">
          {ROLES.map((r, i) => (
            <div key={r.who} className={`border-b border-border py-6 sm:pr-10 ${i % 2 === 1 ? "sm:border-l sm:pl-10" : ""}`}>
              <dt className="text-lg font-semibold">{r.who}</dt>
              <dd className="mt-1 text-muted">{r.what}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* Trust */}
      <section className="border-y border-white/8 bg-nav text-nav-foreground">
        <div className="mx-auto w-full max-w-6xl px-4 py-20">
          <h2 className="display text-[clamp(1.9rem,4vw,3rem)] text-white">Built around trust</h2>
          <ul className="mt-12 grid gap-10 md:grid-cols-3">
            {TRUST.map((t) => (
              <li key={t.title} className="border-t border-white/15 pt-5">
                <h3 className="text-lg text-brand">{t.title}</h3>
                <p className="mt-2">{t.text}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 lg:grid-cols-[0.8fr_1.2fr]">
        <h2 className="display text-[clamp(1.9rem,3.1vw,2.6rem)]">Questions colleges ask</h2>
        <div className="divide-y divide-border border-y border-border">
          {FAQ.map((f) => (
            <details key={f.q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-lg font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary [&::-webkit-details-marker]:hidden">
                {f.q}
                <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border transition-transform duration-200 group-open:rotate-45 group-open:bg-brand group-open:text-brand-foreground group-open:border-brand">+</span>
              </summary>
              <p className="mt-3 max-w-2xl text-muted">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Closing call to action */}
      <section className="px-4 pb-20">
        <div className="mx-auto max-w-6xl rounded-[2rem] bg-brand px-6 py-14 text-brand-foreground sm:px-12 sm:py-16">
          <h2 className="display max-w-3xl text-[clamp(2rem,5vw,3.75rem)]">Bring your college on board</h2>
          <p className="mt-4 max-w-xl text-lg">Tell us about your college. We review each application and set up a private workspace if it is approved.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/apply" className="inline-flex h-13 items-center gap-2 rounded-full bg-brand-foreground pl-6 pr-5 text-base font-semibold text-brand transition-transform duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-foreground">Apply as a college <Chevrons /></Link>
            <Link href="/login" className="inline-flex h-13 items-center rounded-full border-2 border-brand-foreground px-6 text-base font-semibold transition-colors duration-150 hover:bg-brand-foreground/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-foreground">Sign in</Link>
          </div>
        </div>
      </section>
    </main>
  );
}

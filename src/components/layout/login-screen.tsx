"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { Logo } from "@/components/ui/logo";

type Who = "student" | "college";

const COPY: Record<Who, { heading: string; hint: string; foot: ReactNode }> = {
  student: {
    heading: "Student sign in",
    hint: "Use the college email you registered with.",
    foot: <>New here? Ask your college for its student sign-up link.</>,
  },
  college: {
    heading: "College sign in",
    hint: "For administrators, placement officers and coordinators. Platform administrators sign in here too.",
    foot: <>Is your college new to CampusConnect? <Link href="/apply" className="font-semibold text-primary underline">Apply to get started</Link>.</>,
  },
};

const POINTS = [
  "Drives, offers and placements in one place",
  "Eligibility checked from verified records",
  "A private workspace for every college",
];

/** Full-page sign-in: brand panel on the left, one form on the right. Student / College only changes the guidance; the sign-in itself is the same. */
export function LoginScreen({ banner, themeSwitch }: { banner?: ReactNode; themeSwitch: ReactNode }) {
  const [who, setWho] = useState<Who>("student");
  const c = COPY[who];
  return (
    <main className="grid min-h-full flex-1 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)]">
      <section className="relative overflow-hidden bg-nav px-6 py-8 text-nav-foreground lg:flex lg:flex-col lg:justify-between lg:px-14 lg:py-12">
        <div aria-hidden="true" className="drift pointer-events-none absolute -right-24 -top-20 h-80 w-80 rounded-full bg-accent/35 blur-3xl" />
        <div aria-hidden="true" className="drift pointer-events-none absolute -bottom-32 -left-20 h-96 w-96 rounded-full bg-primary/40 blur-3xl [animation-delay:-8s]" />
        <Link href="/" className="relative inline-flex items-center gap-2.5 font-display text-xl font-bold tracking-tight text-white"><Logo className="h-8 w-8" />CampusConnect</Link>
        <div className="relative mt-8 lg:mt-0">
          <p className="font-display text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl lg:text-5xl">Welcome back to your placement workspace.</p>
          <ul className="mt-6 hidden space-y-3 text-base lg:block">
            {POINTS.map((p) => (
              <li key={p} className="flex items-center gap-3"><span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-accent" />{p}</li>
            ))}
          </ul>
        </div>
        <p className="relative mt-6 hidden text-sm opacity-80 lg:block">Early access · colleges join by application</p>
      </section>

      <section className="relative flex items-center justify-center px-4 py-10 sm:px-8">
        <div className="absolute right-4 top-4">{themeSwitch}</div>
        <div className="rise w-full max-w-sm space-y-6">
          <div role="group" aria-label="I am signing in as" className="grid grid-cols-2 gap-1 rounded-2xl bg-tint p-1">
            {(["student", "college"] as const).map((k) => (
              <button
                key={k}
                type="button"
                aria-pressed={who === k}
                onClick={() => setWho(k)}
                className={`h-10 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${who === k ? "bg-surface text-foreground shadow-soft" : "text-muted hover:text-foreground"}`}
              >
                {k === "student" ? "Student" : "College staff"}
              </button>
            ))}
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{c.heading}</h1>
            <p className="mt-1 text-sm text-muted">{c.hint}</p>
          </div>
          {banner}
          <LoginForm />
          <p className="text-center text-sm"><Link href="/forgot-password" className="underline">Forgot your password?</Link></p>
          <p className="border-t border-border pt-4 text-center text-sm text-muted">{c.foot}</p>
        </div>
      </section>
    </main>
  );
}

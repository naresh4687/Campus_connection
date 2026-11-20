import Link from "next/link";
import type { ReactNode } from "react";
import { LoginForm } from "@/app/(auth)/login/login-form";
import { Logo } from "@/components/ui/logo";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { LoginShowcase, PanelBand } from "./login-showcase";
import type { Portal } from "@/lib/portals";

const COPY: Record<Portal, { heading: string; hint: string; panel: string; panelText: string; foot: ReactNode }> = {
  student: {
    heading: "Student sign in",
    hint: "Use the college email you registered with.",
    panel: "Welcome back.",
    panelText: "Your drives, results and offers, where you left them.",
    foot: <>New here? Ask your college for its student sign-up link. College staff? <Link href="/login/college" className="font-semibold text-foreground underline underline-offset-4">Staff sign in</Link></>,
  },
  college: {
    heading: "College staff sign in",
    hint: "For college administrators, placement officers and department coordinators.",
    panel: "Welcome back.",
    panelText: "Your college's drives, offers and placements, where you left them.",
    foot: <>Student? <Link href="/login/student" className="font-semibold text-foreground underline underline-offset-4">Student sign in</Link>. New to CampusConnect? <Link href="/apply" className="font-semibold text-foreground underline underline-offset-4">Apply as a college</Link></>,
  },
  platform: {
    heading: "Platform administrator sign in",
    hint: "For the CampusConnect platform team only.",
    panel: "Platform console.",
    panelText: "College applications, workspaces and the audit trail.",
    foot: null,
  },
};


/**
 * Full-page sign-in for one kind of user. Laptop and up: a brand panel (headline, an example of what is waiting, the
 * outlined pipeline band) beside the form column (back link and theme button on top, legal links below).
 * Phone and tablet: a compact panel card on top and the form below; the example preview is left out.
 * The platform page uses the ink panel.
 */
export function LoginScreen({ portal, banner }: { portal: Portal; banner?: ReactNode }) {
  const c = COPY[portal];
  const ink = portal === "platform";
  return (
    <main className="grid min-h-full flex-1 content-start lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:content-stretch">
      <section className={`relative m-3 overflow-hidden rounded-[1.75rem] px-5 pb-7 pt-5 [@media(max-height:32rem)_and_(max-width:63.99rem)]:pb-5 sm:px-8 sm:pb-9 sm:pt-6 lg:flex lg:flex-col lg:rounded-[2rem] lg:px-12 lg:pb-0 lg:pt-10 xl:px-16 ${ink ? "bg-nav text-nav-foreground" : "bg-brand text-brand-foreground"}`}>
        <div className="flex items-center justify-between gap-3">
          <Link href="/" className={`inline-flex min-w-0 items-center gap-2.5 text-lg font-bold tracking-tight sm:text-xl sm:[font-stretch:112%] ${ink ? "text-white" : ""}`}>
            <Logo className={`h-8 w-8 ${ink ? "" : "[&_path]:stroke-brand [&_rect]:fill-brand-foreground"}`} /><span className="truncate">CampusConnect</span>
          </Link>
          <div className="lg:hidden"><ThemeSwitch tone={ink ? "nav" : "brand"} /></div>
        </div>
        <div className="mt-7 sm:mt-10 lg:mt-0 lg:flex lg:flex-1 lg:flex-col lg:justify-center lg:py-10 [@media(max-height:32rem)_and_(max-width:63.99rem)]:hidden">
          <p className={`display text-[clamp(2rem,8.5vw,3rem)] lg:text-[clamp(2.6rem,4.4vw,4.5rem)] ${ink ? "text-white" : ""}`}>{c.panel}</p>
          <p className="mt-3 max-w-md text-base sm:text-lg lg:mt-4">{c.panelText}</p>
          <div className="rise mt-10 hidden max-w-xl lg:block [--i:2]"><LoginShowcase portal={portal} /></div>
        </div>
        <div className="-mx-12 hidden lg:block xl:-mx-16"><PanelBand ink={ink} /></div>
      </section>

      <section className="flex flex-col px-4 pb-8 pt-4 sm:px-8 sm:pt-6 lg:px-10 lg:py-6">
        <div className="hidden items-center justify-between lg:flex">
          <Link href="/" className="inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm font-medium text-muted transition-colors hover:bg-tint hover:text-foreground focus-visible:outline-2 focus-visible:outline-primary">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
            Back to home
          </Link>
          <ThemeSwitch />
        </div>
        <div className="flex flex-1 justify-center lg:items-center">
          <div className="rise w-full max-w-sm space-y-6 sm:max-w-md lg:max-w-[26rem]">
            <div>
              <h1 className="text-[1.75rem] font-bold leading-tight tracking-tight sm:text-3xl lg:text-4xl">{c.heading}</h1>
              <p className="mt-2 text-sm text-muted lg:text-base">{c.hint}</p>
            </div>
            {banner}
            <LoginForm portal={portal} />
            <p className="text-center text-sm"><Link href="/forgot-password" className="underline underline-offset-4">Forgot your password?</Link></p>
            {c.foot ? <p className="border-t border-border pt-4 text-center text-sm text-muted">{c.foot}</p> : null}
          </div>
        </div>
        <nav aria-label="Legal" className="mt-10 flex flex-wrap justify-center gap-x-6 gap-y-2 text-sm text-muted lg:mt-0">
          <span>© CampusConnect</span>
          <Link href="/privacy" className="hover:text-foreground hover:underline">Privacy policy</Link>
          <Link href="/terms" className="hover:text-foreground hover:underline">Terms of service</Link>
          <Link href="/contact" className="hover:text-foreground hover:underline">Contact</Link>
        </nav>
      </section>
    </main>
  );
}

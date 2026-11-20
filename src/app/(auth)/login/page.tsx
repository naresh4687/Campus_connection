import Link from "next/link";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert } from "@/components/ui/alert";

export const metadata = { title: "Sign in — CampusConnect" };

const CHOICES = [
  { href: "/login/student", title: "Student", text: "See your drives, results and offers." },
  { href: "/login/college", title: "College staff", text: "Administrators, placement officers and department coordinators." },
];

/** Where "Sign in", sign-out and expired sessions lead: pick the sign-in page for your kind of account. */
export default async function SignInChooser({ searchParams }: { searchParams: Promise<{ welcome?: string; reset?: string }> }) {
  const sp = await searchParams;
  // No automatic redirect and no list of signed-in accounts: this page only offers the sign-in choices.
  return (
    <AuthShell title="Sign in">
      <div className="space-y-4">
        {sp.welcome ? <Alert kind="success">Your account is ready. Choose where to sign in.</Alert>
          : sp.reset ? <Alert kind="success">Your password was changed. Choose where to sign in.</Alert> : null}
        <p className="text-sm text-muted">Choose the kind of account you have.</p>
        <ul className="space-y-3">
          {CHOICES.map((c) => (
            <li key={c.href}>
              <Link href={c.href} className="group flex items-center justify-between gap-4 rounded-2xl border border-border px-5 py-4 transition-colors duration-150 hover:border-foreground/40 hover:bg-tint focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <span>
                  <span className="block text-lg font-semibold">{c.title}</span>
                  <span className="mt-0.5 block text-sm text-muted">{c.text}</span>
                </span>
                <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 shrink-0 transition-transform duration-150 group-hover:translate-x-1" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
              </Link>
            </li>
          ))}
        </ul>
        <p className="border-t border-border pt-4 text-center text-sm text-muted">Is your college new to CampusConnect? <Link href="/apply" className="font-semibold text-foreground underline underline-offset-4">Apply as a college</Link></p>
      </div>
    </AuthShell>
  );
}

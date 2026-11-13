import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert } from "@/components/ui/alert";
import { HOME_PATH, getSession } from "@/server/auth/session";

export const metadata = { title: "Sign in — CampusConnect" };

export default async function LoginChooser({ searchParams }: { searchParams: Promise<{ welcome?: string; reset?: string }> }) {
  const session = await getSession();
  const sp = await searchParams;
  // A fresh account (welcome / reset) must see the sign-in choice even if another account is still signed in; the actions sign that one out.
  if (session && !sp.welcome && !sp.reset) redirect(HOME_PATH[session.role]);
  const q = sp.welcome ? "?welcome=1" : sp.reset ? "?reset=1" : "";
  const card = "block rounded-lg border border-border bg-background p-4 hover:border-primary focus-visible:outline-2 focus-visible:outline-primary";
  return (
    <AuthShell title="Sign in">
      <div className="space-y-4">
        {sp.welcome ? <Alert kind="success">Your account is ready. Choose how to sign in.</Alert> : null}
        {sp.reset ? <Alert kind="success">Your password was changed. Choose how to sign in.</Alert> : null}
        <Link href={`/login/student${q}`} className={card}><span className="block font-semibold">I am a student</span><span className="mt-1 block text-sm text-muted">Sign in with your college email.</span></Link>
        <Link href={`/login/college${q}`} className={card}><span className="block font-semibold">I work at a college</span><span className="mt-1 block text-sm text-muted">Administrators, placement officers and coordinators. Platform administrators also sign in here.</span></Link>
        <p className="text-center text-sm text-muted">New student? Ask your college for its sign-up link. Colleges: <Link href="/apply" className="underline">apply to use CampusConnect</Link>.</p>
      </div>
    </AuthShell>
  );
}

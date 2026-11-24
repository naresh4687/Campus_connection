import { LoginScreen } from "@/components/layout/login-screen";
import { Alert } from "@/components/ui/alert";
import { safeNextPath, type Portal } from "@/lib/portals";

export type SignInSearch = Promise<{ welcome?: string; reset?: string; next?: string }>;

/**
 * One sign-in page (student, college staff or platform). It never redirects and never lists who is signed in: every role
 * has its own session, so anyone can sign in here as another role without being sent to an earlier account.
 */
export async function SignInPage({ portal, searchParams }: { portal: Portal; searchParams: SignInSearch }) {
  const sp = await searchParams;
  const notice = sp.welcome ? <Alert kind="success">Your account is ready. Sign in to continue.</Alert>
    : sp.reset ? <Alert kind="success">Your password was changed. Sign in with the new password.</Alert> : null;
  return <LoginScreen portal={portal} banner={notice} next={portal === "student" ? safeNextPath(sp.next) : null} />;
}

import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/layout/login-screen";
import { Alert } from "@/components/ui/alert";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { HOME_PATH, getSession } from "@/server/auth/session";

export const metadata = { title: "Sign in — CampusConnect" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ welcome?: string; reset?: string }> }) {
  const session = await getSession();
  const sp = await searchParams;
  // A fresh account (welcome / reset) must see the sign-in form even if another account is still signed in; the actions sign that one out.
  if (session && !sp.welcome && !sp.reset) redirect(HOME_PATH[session.role]);
  const banner = sp.welcome ? <Alert kind="success">Your account is ready. Sign in to continue.</Alert>
    : sp.reset ? <Alert kind="success">Your password was changed. Sign in with the new password.</Alert> : null;
  return <LoginScreen banner={banner} themeSwitch={<ThemeSwitch />} />;
}

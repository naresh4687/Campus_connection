import { sql } from "kysely";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/layout/auth-shell";
import { Alert } from "@/components/ui/alert";
import { buttonClass } from "@/components/ui/button";
import { otpauthUrl } from "@/lib/totp";
import { logoutAction } from "@/server/auth/actions";
import { MFA_REQUIRED_ROLES, mfaSwitchedOn, openSecret } from "@/server/auth/mfa";
import { HOME_PATH, requireAccountSession, withSession } from "@/server/auth/session";
import { ConfirmForm, DisableForm, StartForm } from "./mfa-forms";

export const metadata = { title: "Two-step sign-in — CampusConnect" };

export default async function SecurityPage() {
  const s = await requireAccountSession();
  if (!mfaSwitchedOn()) redirect(HOME_PATH[s.role]);
  const st = await withSession(s, async (t) => (await sql<{ enabled: boolean; pending_enc: string | null; codes_left: number }>`SELECT * FROM auth.mfa_my_status()`.execute(t)).rows[0]);
  const required = MFA_REQUIRED_ROLES.includes(s.role);
  const secret = !st.enabled && st.pending_enc ? openSecret(st.pending_enc, s.userId) : null;
  const home = HOME_PATH[s.role];
  return (
    <AuthShell title="Two-step sign-in">
      <div className="space-y-4 text-sm">
        <p>Signed in as <strong>{s.email}</strong>.</p>
        {st.enabled ? (
          <>
            <Alert kind="success">Two-step sign-in is on. You have {st.codes_left} unused recovery code{st.codes_left === 1 ? "" : "s"}.</Alert>
            {required ? <p className="text-muted">Administrators must keep it on. To move to a new phone, ask the person above you to remove it, then set it up again.</p> : <DisableForm />}
          </>
        ) : (
          <p className="text-muted">{required ? "Your role needs two-step sign-in. Set it up to continue." : "Optional: after your password, you also enter a code from your phone."}</p>
        )}
        {/* ConfirmForm stays mounted after success so the recovery codes remain on screen. */}
        {secret ? <ConfirmForm secret={secret} url={otpauthUrl(secret, s.email)} home={home} /> : !st.enabled ? <StartForm /> : null}
        {!required || st.enabled ? <p className="text-center"><a href={home} className={buttonClass("secondary", "w-full")}>Back to the app</a></p> : null}
        <form action={logoutAction} className="text-center"><button type="submit" className="underline">Sign out</button></form>
      </div>
    </AuthShell>
  );
}

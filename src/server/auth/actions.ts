"use server";

import { sql } from "kysely";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db, withTenantTx } from "../db";
import { contextOf, currentTokenHash, endSession, HOME_PATH, requireSession, startSession } from "./session";
import { allow, allowIp } from "./rate-limit";
import { assertSameOrigin, clientIpHash } from "./request";
import { dummyHash, hashPassword, newPasswordSchema, verifyPassword } from "./password";
import { hashToken, isWellFormedToken } from "./tokens";
import { isPortal, LOGIN_PATH, loginPathForRole, portalOfRole, safeNextPath, slotOfRole, type Portal } from "@/lib/portals";

/**
 * `values` echoes back NON-secret fields so the form does not lose them after an error (passwords are never echoed).
 * `goTo` is a sign-in page to point to when someone used the wrong one.
 */
export type FormState = { error?: string; ok?: string; values?: Record<string, string>; goTo?: string } | undefined;

const text = (v: FormDataEntryValue | null, max = 254) => (typeof v === "string" ? v.slice(0, max) : "");

const GENERIC_LOGIN_ERROR = "Invalid email or password.";
const WRONG_PAGE: Record<Exclude<Portal, "platform">, string> = {
  student: "This account is a student account. Students sign in on the student page.",
  college: "This account belongs to college staff. Staff sign in on the college staff page.",
};
const RATE_ERROR = "Too many attempts. Please wait a few minutes and try again.";
const TOKEN_ERROR = "This link is invalid or has expired. Ask your administrator for a new one.";

const emailSchema = z.string().trim().toLowerCase().min(3).max(254).pipe(z.email());

async function logEvent(userId: string | null, action: string, meta: Record<string, unknown> = {}) {
  await sql`SELECT auth.log_auth_event(${userId}::uuid, ${action}, ${await clientIpHash()}, ${JSON.stringify(meta)}::jsonb)`.execute(db());
}

export async function loginAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await assertSameOrigin();
  const parsed = z.object({ email: emailSchema, password: z.string().min(1).max(128) }).safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  const values = { email: text(formData.get("email")) };
  const portal = formData.get("portal");
  if (!parsed.success || !isPortal(portal)) return { error: GENERIC_LOGIN_ERROR, values };
  const { email, password } = parsed.data;

  if (!(await allow("login-email", email, 8, 15 * 60)) || !(await allowIp("login", 60, 15 * 60))) {
    await logEvent(null, "LOGIN_BLOCKED");
    return { error: RATE_ERROR, values };
  }

  const r = await sql<{
    id: string; password_hash: string; status: string; role: string; college_id: string | null; college_active: boolean;
  }>`SELECT * FROM auth.get_login_user(${email})`.execute(db());
  const user = r.rows[0];

  // Always run one Argon2 verification so timing does not reveal whether the account exists.
  const passwordOk = await verifyPassword(user?.password_hash ?? (await dummyHash()), password);
  if (!user || !passwordOk || user.status !== "ACTIVE" || !user.college_active) {
    await logEvent(user?.id ?? null, "LOGIN_FAILED");
    return { error: GENERIC_LOGIN_ERROR, values };
  }

  // Each kind of user has their own sign-in page. A student or staff member on the other one is pointed to theirs (they
  // proved the password, so this reveals nothing new). Anything involving the platform page stays a plain failure.
  const own = portalOfRole(user.role);
  if (own !== portal) {
    await logEvent(user.id, "LOGIN_FAILED", { reason: "wrong_sign_in_page" });
    if (!own || own === "platform" || portal === "platform") return { error: GENERIC_LOGIN_ERROR, values };
    return { error: WRONG_PAGE[own], values, goTo: LOGIN_PATH[own] };
  }

  const slot = slotOfRole(user.role);
  if (!slot) return { error: GENERIC_LOGIN_ERROR, values };
  await startSession(user.id, slot);   // this role's own cookie: other roles signed in in this browser are untouched
  await logEvent(user.id, "LOGIN_SUCCEEDED");
  const next = slot === "student" ? safeNextPath(formData.get("next")) : null;   // e.g. an attendance link the student opened while signed out
  redirect(next ?? HOME_PATH[user.role as keyof typeof HOME_PATH]);
}

export async function logoutAction(): Promise<void> {
  await assertSameOrigin();
  const s = await endSession();
  if (s) await logEvent(s.userId, "LOGOUT");
  // Back to this area's own sign-in page; other areas signed in in this browser stay as they are and are never switched to.
  redirect(s ? LOGIN_PATH[s.portal] : "/login");
}

const acceptSchema = z
  .object({
    token: z.string().refine(isWellFormedToken),
    fullName: z.string().trim().min(1, "Enter your name.").max(200),
    password: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] });

export async function acceptInvitationAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await assertSameOrigin();
  const values = { fullName: text(formData.get("fullName"), 200) };
  const parsed = acceptSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? TOKEN_ERROR, values };
  const { token, fullName, password } = parsed.data;
  let accepted: { role: string } | undefined;
  if (!(await allow("invite-token", token, 10, 15 * 60)) || !(await allowIp("invite", 60, 15 * 60))) return { error: RATE_ERROR, values };

  try {
    accepted = (await sql<{ role: string }>`SELECT * FROM auth.accept_invitation(${hashToken(token)}, ${fullName}, ${await hashPassword(password)})`.execute(db())).rows[0];
  } catch (e) {
    if ((e as { code?: string }).code === "P0001") return { error: TOKEN_ERROR, values };
    if ((e as { code?: string }).code === "23505") return { error: "An account with this email already exists. Try signing in.", values };
    throw e;
  }
  // Never leave a different account signed in in this area (other areas, e.g. a student session, are someone else's business).
  const slot = accepted ? slotOfRole(accepted.role) : null;
  if (slot) await endSession(slot);
  redirect(loginPathForRole(accepted?.role, "welcome"));
}

const resetSchema = z
  .object({
    token: z.string().refine(isWellFormedToken),
    password: newPasswordSchema,
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] });

export async function completePasswordResetAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await assertSameOrigin();
  const parsed = resetSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? TOKEN_ERROR };
  const { token, password } = parsed.data;
  if (!(await allow("reset-token", token, 10, 15 * 60)) || !(await allowIp("reset", 60, 15 * 60))) return { error: RATE_ERROR };

  // Which sign-in page to send them to afterwards (read before the link is used up).
  const email = (await sql<{ email: string }>`SELECT * FROM auth.peek_password_reset(${hashToken(token)})`.execute(db())).rows[0]?.email;
  const role = email ? (await sql<{ role: string }>`SELECT role FROM auth.get_login_user(${email})`.execute(db())).rows[0]?.role : null;
  try {
    await sql`SELECT auth.complete_password_reset(${hashToken(token)}, ${await hashPassword(password)})`.execute(db());
  } catch (e) {
    if ((e as { code?: string }).code === "P0001") return { error: TOKEN_ERROR };
    throw e;
  }
  const slot = role ? slotOfRole(role) : null;
  if (slot) await endSession(slot);
  redirect(loginPathForRole(role, "reset"));
}

export async function changePasswordAction(_prev: FormState, formData: FormData): Promise<FormState> {
  await assertSameOrigin();
  const s = await requireSession();
  const parsed = z
    .object({ current: z.string().min(1).max(128), password: newPasswordSchema, confirm: z.string() })
    .refine((v) => v.password === v.confirm, { message: "Passwords do not match.", path: ["confirm"] })
    .safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  if (!(await allow("change-password", s.userId, 5, 15 * 60))) return { error: RATE_ERROR };

  const r = await sql<{ password_hash: string }>`SELECT password_hash FROM auth.get_login_user(${s.email})`.execute(db());
  if (!(await verifyPassword(r.rows[0]?.password_hash ?? (await dummyHash()), parsed.data.current))) {
    return { error: "Your current password is incorrect." };
  }
  const keep = await currentTokenHash();
  const newHash = await hashPassword(parsed.data.password);
  await withTenantTx(contextOf(s), (trx) => sql`SELECT auth.change_own_password(${newHash}, ${keep})`.execute(trx));
  return { ok: "Password changed. Your other sessions were signed out." };
}

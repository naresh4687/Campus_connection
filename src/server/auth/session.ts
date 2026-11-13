import { sql } from "kysely";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { config } from "../config";
import { db, withTenantTx, type Database } from "../db";
import type { RequestContext, Role } from "../db/context";
import type { Transaction } from "kysely";
import { clientIpHash, userAgent } from "./request";
import { hashToken, isWellFormedToken, newToken } from "./tokens";

export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;

export type SessionUser = {
  sessionId: string;
  userId: string;
  role: Role;
  collegeId: string | null;
  fullName: string;
  email: string;
};

export const cookieName = () => (config().AUTH_COOKIE_SECURE ? "__Host-cc_session" : "cc_session");

export const HOME_PATH: Record<Role, string> = {
  PLATFORM_SUPER_ADMIN: "/platform",
  COLLEGE_ADMIN: "/college",
  PLACEMENT_OFFICER: "/placement",
  COORDINATOR: "/coordinator",
  STUDENT: "/student",
};

/** Creates a session row and sets the cookie. Server Actions / Route Handlers only. */
export async function startSession(userId: string): Promise<void> {
  const token = newToken();
  await sql`SELECT auth.create_session(${userId}::uuid, ${hashToken(token)}, ${SESSION_IDLE_SECONDS}, ${SESSION_ABSOLUTE_SECONDS},
            ${await clientIpHash()}, ${await userAgent()})`.execute(db());
  (await cookies()).set(cookieName(), token, {
    httpOnly: true,
    secure: config().AUTH_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_ABSOLUTE_SECONDS,
  });
}

/** Revokes the current session (if any) and clears the cookie. Server Actions / Route Handlers only. */
export async function endSession(): Promise<SessionUser | null> {
  const current = await getSession();
  const jar = await cookies();
  const token = jar.get(cookieName())?.value;
  if (isWellFormedToken(token)) await sql`SELECT auth.revoke_session(${hashToken(token)})`.execute(db());
  jar.delete(cookieName());
  return current;
}

/** Hash of the caller's current session token, so "change password" can keep this session alive. */
export async function currentTokenHash(): Promise<Buffer | null> {
  const token = (await cookies()).get(cookieName())?.value;
  return isWellFormedToken(token) ? hashToken(token) : null;
}

/** Resolves the session from the cookie against the database. Memoised per request. */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(cookieName())?.value;
  if (!isWellFormedToken(token)) return null;
  const r = await sql<{
    session_id: string; user_id: string; role: Role; college_id: string | null; full_name: string; email: string;
  }>`SELECT * FROM auth.resolve_session(${hashToken(token)})`.execute(db());
  const row = r.rows[0];
  if (!row) return null;
  return { sessionId: row.session_id, userId: row.user_id, role: row.role, collegeId: row.college_id, fullName: row.full_name, email: row.email };
});

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}

/** Page/action guard: not signed in -> /login; signed in with the wrong role -> that user's own home. */
export async function requireRole(...allowed: Role[]): Promise<SessionUser> {
  const s = await requireSession();
  if (!allowed.includes(s.role)) redirect(HOME_PATH[s.role]);
  return s;
}

export const contextOf = (s: SessionUser): RequestContext => ({ userId: s.userId, collegeId: s.collegeId, role: s.role });

/** Run database work as the signed-in user, under RLS. */
export function withSession<T>(s: SessionUser, fn: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  return withTenantTx(contextOf(s), fn);
}

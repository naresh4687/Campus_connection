import { sql } from "kysely";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { config } from "../config";
import { db, withTenantTx, type Database } from "../db";
import type { RequestContext, Role } from "../db/context";
import type { Transaction } from "kysely";
import { mfaSetupRequired } from "./mfa";
import { clientIpHash, userAgent } from "./request";
import { hashToken, isWellFormedToken, newToken } from "./tokens";
import { isSlot, LOGIN_PATH, PORTAL_OF_SLOT, safeNextPath, SLOT_HEADER, SLOTS, slotOfRole, type Portal, type Slot } from "@/lib/portals";

export const SESSION_IDLE_SECONDS = 30 * 60;
export const SESSION_ABSOLUTE_SECONDS = 12 * 60 * 60;

export type SessionUser = {
  sessionId: string;
  userId: string;
  role: Role;
  collegeId: string | null;
  fullName: string;
  email: string;
  /** The role slot (and so the cookie) this session belongs to. */
  slot: Slot;
  /** The sign-in page that serves it. */
  portal: Portal;
};

/**
 * One cookie per role slot (src/lib/portals.ts), so different roles signed in in different tabs of one browser never
 * replace each other. `__Host-` (Secure, Path=/, no Domain) whenever cookies are secure.
 */
export const cookieNameFor = (slot: Slot) => `${config().AUTH_COOKIE_SECURE ? "__Host-" : ""}cc_session_${slot}`;

/** The role slot of this request, as decided by the proxy from the path or ?as= (null for shared or public pages). */
async function requestSlot(): Promise<Slot | null> {
  const v = (await headers()).get(SLOT_HEADER);
  return isSlot(v) ? v : null;
}

export const HOME_PATH: Record<Role, string> = {
  PLATFORM_SUPER_ADMIN: "/platform",
  COLLEGE_ADMIN: "/college",
  PLACEMENT_OFFICER: "/placement",
  COORDINATOR: "/coordinator",
  STUDENT: "/student",
};

/** Creates a session row and sets that area's cookie (ending any earlier session in the same area). Server Actions / Route Handlers only. */
export async function startSession(userId: string, slot: Slot): Promise<void> {
  await endSession(slot);
  const token = newToken();
  await sql`SELECT auth.create_session(${userId}::uuid, ${hashToken(token)}, ${SESSION_IDLE_SECONDS}, ${SESSION_ABSOLUTE_SECONDS},
            ${await clientIpHash()}, ${await userAgent()})`.execute(db());
  (await cookies()).set(cookieNameFor(slot), token, {
    httpOnly: true,
    secure: config().AUTH_COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_ABSOLUTE_SECONDS,
  });
}

/**
 * Revokes one area's session and clears its cookie: the given area, else the area of this request's session.
 * Other areas stay signed in. Server Actions / Route Handlers only.
 */
export async function endSession(slot?: Slot | null): Promise<SessionUser | null> {
  const current = slot ? await sessionFor(slot) : await anySession();
  const area = slot ?? current?.slot ?? (await requestSlot());
  if (!area) return current;
  const jar = await cookies();
  const token = jar.get(cookieNameFor(area))?.value;
  if (isWellFormedToken(token)) await sql`SELECT auth.revoke_session(${hashToken(token)})`.execute(db());
  jar.delete(cookieNameFor(area));
  return current;
}

/** Hash of the caller's current session token, so "change password" can keep this session alive. */
export async function currentTokenHash(of?: SessionUser): Promise<Buffer | null> {
  const s = of ?? (await getSession());
  const token = s ? (await cookies()).get(cookieNameFor(s.slot))?.value : undefined;
  return isWellFormedToken(token) ? hashToken(token) : null;
}

/**
 * One area's session, from that area's cookie, checked against the database. A cookie only ever counts for its own
 * area: a session whose role belongs elsewhere is ignored. Memoised per request.
 */
const sessionFor = cache(async (slot: Slot): Promise<SessionUser | null> => {
  const token = (await cookies()).get(cookieNameFor(slot))?.value;
  if (!isWellFormedToken(token)) return null;
  const r = await sql<{
    session_id: string; user_id: string; role: Role; college_id: string | null; full_name: string; email: string;
  }>`SELECT * FROM auth.resolve_session(${hashToken(token)})`.execute(db());
  const row = r.rows[0];
  if (!row || slotOfRole(row.role) !== slot) return null;
  return { sessionId: row.session_id, userId: row.user_id, role: row.role, collegeId: row.college_id, fullName: row.full_name, email: row.email, slot, portal: PORTAL_OF_SLOT[slot] };
});

/**
 * One area's session as the app may use it: an administrator who has not yet set up two-step sign-in counts as not signed
 * in everywhere except the setup page (see requireSession and requireAccountSession).
 */
export const getSessionFor = cache(async (slot: Slot): Promise<SessionUser | null> => {
  const s = await sessionFor(slot);
  return s && !(await mfaSetupRequired(s.userId, s.role)) ? s : null;
});

/** The request's session whether or not two-step setup is still owed. Only sign-out and the setup page use this. */
async function anySession(): Promise<SessionUser | null> {
  const slot = await requestSlot();
  if (slot) return sessionFor(slot);
  for (const s of SLOTS) { const x = await sessionFor(s); if (x) return x; }
  return null;
}

/** Guard for the two-step setup page and its actions. */
export async function requireAccountSession(): Promise<SessionUser> {
  const s = await anySession();
  if (s) return s;
  redirect("/login");
}

/** Every area signed in in this browser (for shared downloads, which may belong to any of them). */
/** The first signed-in session served by a sign-in page (any of its role slots). */
export async function getSessionInPortal(portal: Portal): Promise<SessionUser | null> {
  for (const s of SLOTS) if (PORTAL_OF_SLOT[s] === portal) { const x = await getSessionFor(s); if (x) return x; }
  return null;
}

export async function getSessions(): Promise<SessionUser[]> {
  const all = await Promise.all(SLOTS.map((p) => getSessionFor(p)));
  return all.filter((s): s is SessionUser => s !== null);
}

/**
 * Sessions a shared route (downloads, notification links, exports) may act as: the ?as= area only when given, otherwise
 * every area signed in, in a fixed order. The database still decides, for each one, what it may open.
 */
export async function candidateSessions(): Promise<SessionUser[]> {
  const slot = await requestSlot();
  if (slot) { const s = await getSessionFor(slot); return s ? [s] : []; }
  return getSessions();
}

/**
 * The session for this request: the area's own session on area pages (/student, /college, …, or a shared page with
 * ?as=), otherwise the first area that is signed in. Memoised per request.
 */
export const getSession = cache(async (): Promise<SessionUser | null> => {
  const slot = await requestSlot();
  if (slot) return getSessionFor(slot);
  return (await getSessions())[0] ?? null;
});

/**
 * Page/action guard. Each area is independent: not signed in for this area means this area's own sign-in page, never
 * another signed-in account's dashboard. Shared pages with nobody signed in go to the sign-in chooser.
 */
export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (s) return s;
  const unfinished = await anySession();
  if (unfinished) redirect(`/security?as=${unfinished.slot}`);
  const slot = await requestSlot();
  // An attendance link opened while signed out: sign in, then come back to it (allow-listed paths only).
  const next = safeNextPath((await headers()).get("x-cc-path"));
  redirect(slot ? `${LOGIN_PATH[PORTAL_OF_SLOT[slot]]}${next ? `?next=${encodeURIComponent(next)}` : ""}` : "/login");
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

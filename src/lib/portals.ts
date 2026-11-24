/**
 * Each kind of user signs in on their own page. A correct password on the wrong page does not sign anyone in.
 * Client-safe (no server imports): the sign-in screens use it too.
 */
export type Portal = "student" | "college" | "platform";

export const PORTALS: readonly Portal[] = ["student", "college", "platform"];

export const LOGIN_PATH: Record<Portal, string> = {
  student: "/login/student",
  college: "/login/college",
  platform: "/admin/login",
};

const PORTAL_OF_ROLE: Record<string, Portal> = {
  STUDENT: "student",
  COLLEGE_ADMIN: "college",
  PLACEMENT_OFFICER: "college",
  COORDINATOR: "college",
  PLATFORM_SUPER_ADMIN: "platform",
};

export function portalOfRole(role: string): Portal | null {
  return PORTAL_OF_ROLE[role] ?? null;
}

export function isPortal(v: unknown): v is Portal {
  return typeof v === "string" && (PORTALS as readonly string[]).includes(v);
}

/** Where to send someone after an invitation or a password reset: their own sign-in page, or the chooser if unknown. */
export function loginPathForRole(role: string | null | undefined, notice: "welcome" | "reset"): string {
  const portal = role ? portalOfRole(role) : null;
  return `${portal ? LOGIN_PATH[portal] : "/login"}?${notice}=1`;
}

/**
 * Sessions are kept per ROLE ("slot"), so any mix of roles can be signed in side by side in one browser (one tab each):
 * a platform administrator, a college administrator, a placement officer, a coordinator and a student. Every role has its
 * own URL prefix, so a page (and a refresh of it) always knows whose session it belongs to. The sign-in pages above stay
 * three (student, college staff, platform); a staff sign-in fills the slot of the role the account has.
 * Two accounts with the SAME role cannot share one browser (one cookie per role); use another browser profile for that.
 */
export type Slot = "platform" | "college" | "placement" | "coordinator" | "student";

/** Also the order in which a shared page without ?as= picks a session. */
export const SLOTS: readonly Slot[] = ["college", "placement", "coordinator", "student", "platform"];

const SLOT_OF_ROLE: Record<string, Slot> = {
  PLATFORM_SUPER_ADMIN: "platform", COLLEGE_ADMIN: "college", PLACEMENT_OFFICER: "placement", COORDINATOR: "coordinator", STUDENT: "student",
};
export const slotOfRole = (role: string): Slot | null => SLOT_OF_ROLE[role] ?? null;
export const isSlot = (v: unknown): v is Slot => typeof v === "string" && (SLOTS as readonly string[]).includes(v);

/** Which sign-in page serves a slot. */
export const PORTAL_OF_SLOT: Record<Slot, Portal> = { platform: "platform", college: "college", placement: "college", coordinator: "college", student: "student" };
export const slotsOfPortal = (portal: Portal): Slot[] => SLOTS.filter((s) => PORTAL_OF_SLOT[s] === portal);

/** The proxy passes the request's slot to the app in this header; it always overwrites whatever the client sent. */
export const SLOT_HEADER = "x-cc-slot";

/** The slot a path belongs to (the role's own pages), or null for shared and public pages. */
export function slotOfPath(pathname: string): Slot | null {
  for (const s of SLOTS) if (pathname === `/${s}` || pathname.startsWith(`/${s}/`)) return s;
  return null;
}

/** A link to a shared page (account, notifications) that stays with the given role's session. */
export function scopedHref(href: string, slot: Slot): string {
  return `${href}${href.includes("?") ? "&" : "?"}as=${slot}`;
}

/**
 * Where a sign-in may send the person afterwards instead of their home page. A narrow allow-list (never a free redirect): the attendance link of an
 * on-campus drive, so a student who opens it signed-out comes back to it after signing in.
 */
export const safeNextPath = (v: unknown): string | null => (typeof v === "string" && /^\/student\/campus\/attend\/[0-9a-f]{64}$/.test(v) ? v : null);

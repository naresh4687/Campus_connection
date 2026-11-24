import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "@/lib/csp";
import { isSlot, SLOT_HEADER, slotOfPath } from "@/lib/portals";

/**
 * Every request: decide which role's session it belongs to (see src/lib/portals.ts). The header is always replaced, so a
 * client cannot choose another role's session by sending it. Shared pages say which area they belong to with ?as=.
 * Page requests also get a fresh CSP nonce; Next.js reads it from the request's CSP header and applies it to its own
 * scripts and styles. Link prefetches skip the CSP (as before) but still need the area.
 */
export function proxy(request: NextRequest) {
  const headers = new Headers(request.headers);
  const as = request.nextUrl.searchParams.get("as");
  const slot = slotOfPath(request.nextUrl.pathname) ?? (isSlot(as) ? as : null);
  headers.delete(SLOT_HEADER);
  headers.delete("x-cc-path");     // the request path, for "sign in then come back" (see requireSession); never client-supplied
  headers.set("x-cc-path", request.nextUrl.pathname);
  headers.delete("x-cc-portal");   // the earlier name of this header: never let a client supply it either
  if (slot) headers.set(SLOT_HEADER, slot);

  const prefetch = request.headers.has("next-router-prefetch") || request.headers.get("purpose") === "prefetch";
  if (prefetch) return NextResponse.next({ request: { headers } });

  const nonce = newNonce();
  // upgrade-insecure-requests only when the deployment is HTTPS (secure cookies); plain http (local, browser tests) must not be upgraded.
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === "development", upgrade: process.env.AUTH_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production" });
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)" }],
};

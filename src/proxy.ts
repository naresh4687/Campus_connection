import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, newNonce } from "@/lib/csp";

// Adds a fresh CSP nonce to every page request. Next.js reads the nonce from the request's CSP header and applies it to its own scripts and styles.
export function proxy(request: NextRequest) {
  const nonce = newNonce();
  // upgrade-insecure-requests only when the deployment is HTTPS (secure cookies); plain http (local, browser tests) must not be upgraded.
  const csp = buildCsp({ nonce, dev: process.env.NODE_ENV === "development", upgrade: process.env.AUTH_COOKIE_SECURE !== "false" && process.env.NODE_ENV === "production" });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [{ source: "/((?!_next/static|_next/image|favicon.ico).*)", missing: [{ type: "header", key: "next-router-prefetch" }, { type: "header", key: "purpose", value: "prefetch" }] }],
};

import { headers } from "next/headers";
import { config } from "../config";
import { hmac } from "./tokens";

/** Client IP only when we sit behind a known number of trusted proxies; otherwise null (never trust raw X-Forwarded-For). */
export async function clientIp(): Promise<string | null> {
  const hops = config().TRUSTED_PROXY_HOPS;
  if (hops === 0) return null;
  const xff = (await headers()).get("x-forwarded-for");
  if (!xff) return null;
  const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
  return parts[parts.length - hops] ?? null;
}

export async function clientIpHash(): Promise<string | null> {
  const ip = await clientIp();
  return ip ? hmac(config().AUTH_PEPPER, `ip:${ip}`) : null;
}

export async function userAgent(): Promise<string | null> {
  return (await headers()).get("user-agent");
}

/**
 * Defence in depth on top of Next's built-in Server Action origin check and SameSite=Lax cookies:
 * a state-changing request must come from our own origin.
 */
export async function assertSameOrigin(): Promise<void> {
  const h = await headers();
  const origin = h.get("origin");
  const host = (config().TRUSTED_PROXY_HOPS > 0 ? h.get("x-forwarded-host") : null) ?? h.get("host");
  // A concrete Origin must match our host.
  if (origin && origin !== "null") {
    let ok = false;
    try {
      ok = new URL(origin).host === host;
    } catch {
      ok = false;
    }
    if (!ok) throw new Error("Cross-origin request rejected");
    return;
  }
  // No Origin, or the opaque "null" origin (browsers send it on same-origin form posts when Referrer-Policy is no-referrer, which we set
  // to keep one-time tokens out of Referer headers). Fall back to Fetch Metadata: the browser itself marks the request's relationship
  // to our site, and page scripts cannot forge it. A cross-site form arrives as "cross-site" and is refused.
  if (h.get("sec-fetch-site") !== "same-origin") throw new Error("Cross-origin request rejected");
}

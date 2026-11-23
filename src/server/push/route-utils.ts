import { headers } from "next/headers";
import { allow } from "../auth/rate-limit";
import { assertSameOrigin } from "../auth/request";
import { getSession, type SessionUser } from "../auth/session";

const NO_STORE = { "Cache-Control": "no-store" };
export const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

/**
 * Common front door for the push API: same origin, signed in (as the area in ?as=), a college user (platform administrators have no
 * college and no push), a small JSON body, and a per-user rate limit. Returns the session and body, or a ready response.
 */
export async function pushRequest(req: Request, scope: string, max: number): Promise<{ s: SessionUser; body: unknown } | { res: Response }> {
  try { await assertSameOrigin(); } catch { return { res: json({ error: "forbidden" }, 403) }; }
  const s = await getSession();
  if (!s) return { res: json({ error: "unauthorized" }, 401) };
  if (!s.collegeId) return { res: json({ error: "not available for this account" }, 403) };
  if (!(await allow(`push-${scope}`, s.userId, max, 3600))) return { res: json({ error: "too many requests" }, 429) };
  const text = await req.text();
  if (text.length > 4096) return { res: json({ error: "too large" }, 413) };
  let body: unknown = null;
  try { body = text ? JSON.parse(text) : null; } catch { return { res: json({ error: "invalid body" }, 400) }; }
  return { s, body };
}

export async function userAgentHeader() { return (await headers()).get("user-agent"); }

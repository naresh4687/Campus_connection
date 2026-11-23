/**
 * Push subscription endpoints are URLs the SERVER will later send requests to, so only the browser vendors' real push services are accepted:
 * https, default port, no credentials, and an exact host from this list. Checked when storing (schema + database) and again before sending.
 */
const EXACT = new Set(["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"]);

export function isAllowedPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 1000) return false;
  let u: URL;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== "https:" || u.port !== "" || u.username || u.password || /\s/.test(endpoint)) return false;
  const h = u.hostname.toLowerCase().replace(/\.$/, "");
  return EXACT.has(h) || /^([a-z0-9-]+\.)+notify\.windows\.com$/.test(h);
}

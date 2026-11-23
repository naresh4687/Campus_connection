/**
 * Content-Security-Policy with a per-request nonce. Scripts run only if they carry the nonce ('strict-dynamic' lets those scripts load
 * their own chunks); there is no 'unsafe-inline' and no 'unsafe-eval' in production. Inline style ATTRIBUTES are not allowed either, so
 * components must not use style="" (use classes or SVG attributes).
 */
export function buildCsp({ nonce, dev, upgrade }: { nonce: string; dev: boolean; upgrade: boolean }): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    "worker-src 'self'",
  ];
  if (upgrade) directives.push("upgrade-insecure-requests");
  return directives.join("; ");
}

export const newNonce = () => Buffer.from(crypto.randomUUID()).toString("base64");

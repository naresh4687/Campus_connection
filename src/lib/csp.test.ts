import { describe, expect, it } from "vitest";
import { buildCsp, newNonce } from "./csp";

describe("buildCsp", () => {
  const prod = buildCsp({ nonce: "abc123", dev: false, upgrade: true });
  const dir = (name: string) => prod.split("; ").find((d) => d.startsWith(name + " "))!;
  it("allows scripts only with the nonce (strict-dynamic), never inline or eval, in production", () => {
    expect(dir("script-src")).toBe("script-src 'self' 'nonce-abc123' 'strict-dynamic'");
    expect(prod).not.toContain("unsafe-inline"); expect(prod).not.toContain("unsafe-eval");
  });
  it("locks down framing, plugins, base URI, form targets and other origins", () => {
    for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'", "connect-src 'self'"]) expect(prod.split("; ")).toContain(d);
    expect(dir("style-src")).toBe("style-src 'self' 'nonce-abc123'");                    // no 'unsafe-inline': inline style attributes are blocked
    expect(prod).not.toMatch(/https?:\/\//);                                              // no external origin is allowed anywhere
  });
  it("adds upgrade-insecure-requests only on HTTPS deployments, and unsafe-eval only in development", () => {
    expect(prod).toContain("upgrade-insecure-requests");
    expect(buildCsp({ nonce: "n", dev: false, upgrade: false })).not.toContain("upgrade-insecure-requests");
    expect(buildCsp({ nonce: "n", dev: true, upgrade: false })).toContain("'unsafe-eval'");
  });
  it("a nonce is unpredictable and different every time", () => {
    const set = new Set(Array.from({ length: 200 }, newNonce));
    expect(set.size).toBe(200); for (const n of set) expect(n.length).toBeGreaterThanOrEqual(40);
  });
});

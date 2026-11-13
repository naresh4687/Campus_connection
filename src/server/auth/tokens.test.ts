import { describe, expect, it } from "vitest";
import { hashToken, hmac, isWellFormedToken, newToken } from "./tokens";

describe("tokens", () => {
  it("are 256-bit, URL-safe and unique", () => {
    const a = newToken(), b = newToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(isWellFormedToken(a)).toBe(true);
  });
  it("rejects malformed input before it reaches the database", () => {
    for (const bad of [undefined, null, 42, "", "short", "a".repeat(44), "a".repeat(42) + "!", " " + "a".repeat(42), ["x"]]) expect(isWellFormedToken(bad)).toBe(false);
  });
  it("hash deterministically to 32 bytes and never equal the token", () => {
    const t = newToken();
    expect(hashToken(t)).toHaveLength(32);
    expect(hashToken(t).equals(hashToken(t))).toBe(true);
    expect(hashToken(t).toString("utf8")).not.toContain(t);
    expect(hashToken(t).equals(hashToken(newToken()))).toBe(false);
  });
  it("hmac depends on the secret and the value", () => {
    expect(hmac("a".repeat(32), "x")).toBe(hmac("a".repeat(32), "x"));
    expect(hmac("a".repeat(32), "x")).not.toBe(hmac("b".repeat(32), "x"));
    expect(hmac("a".repeat(32), "x")).not.toBe(hmac("a".repeat(32), "y"));
  });
});

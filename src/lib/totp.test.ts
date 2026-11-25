import { describe, expect, it } from "vitest";
import { base32Decode, base32Encode, matchTotp, newRecoveryCodes, newTotpSecret, normalizeRecoveryCode, stepOf, totpAt } from "./totp";

// RFC 6238 appendix B, SHA-1 rows (the secret is the ASCII text "12345678901234567890").
const SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("totp", () => {
  it("matches the published test vectors", () => {
    for (const [t, code] of [[59, "94287082"], [1111111109, "07081804"], [1234567890, "89005924"], [2000000000, "69279037"]] as const) expect(totpAt(SECRET, stepOf(t * 1000), 8)).toBe(code);
  });
  it("round-trips base32", () => { const s = newTotpSecret(); expect(base32Encode(base32Decode(s))).toBe(s); expect(s).toHaveLength(32); });
  it("accepts one step of drift, and never a used or older step", () => {
    const now = 1_700_000_000_000, step = stepOf(now);
    expect(matchTotp(SECRET, totpAt(SECRET, step), now)).toBe(step);
    expect(matchTotp(SECRET, totpAt(SECRET, step - 1), now)).toBe(step - 1);
    expect(matchTotp(SECRET, totpAt(SECRET, step + 1), now)).toBe(step + 1);
    expect(matchTotp(SECRET, totpAt(SECRET, step - 2), now)).toBeNull();
    expect(matchTotp(SECRET, totpAt(SECRET, step), now, step)).toBeNull();
    expect(matchTotp(SECRET, "abc123", now)).toBeNull();
  });
  it("makes distinct recovery codes that survive how people type them", () => {
    const codes = newRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) { expect(c).toMatch(/^[A-Z2-7]{5}-[A-Z2-7]{5}$/); expect(normalizeRecoveryCode(` ${c.toLowerCase().replace("-", " ")} `)).toBe(c.replace("-", "")); }
  });
});

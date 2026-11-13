import { describe, expect, it } from "vitest";
import { dummyHash, hashPassword, newPasswordSchema, verifyPassword } from "./password";

describe("passwords", () => {
  it("hash with Argon2id and verify", async () => {
    const h = await hashPassword("correct horse battery");
    expect(h.startsWith("$argon2id$")).toBe(true);
    expect(h).toContain("m=19456,t=2,p=1");
    expect(await verifyPassword(h, "correct horse battery")).toBe(true);
    expect(await verifyPassword(h, "correct horse batterY")).toBe(false);
  });
  it("use a fresh salt every time", async () => {
    expect(await hashPassword("same-password-1")).not.toBe(await hashPassword("same-password-1"));
  });
  it("verifyPassword is false (not a throw) for garbage hashes", async () => {
    expect(await verifyPassword("not-a-hash", "x")).toBe(false);
    expect(await verifyPassword("", "x")).toBe(false);
  });
  it("dummy hash is a real Argon2id hash so unknown-account logins cost the same", async () => {
    expect((await dummyHash()).startsWith("$argon2id$")).toBe(true);
    expect(await dummyHash()).toBe(await dummyHash());
  });
  it("policy: 10..128 characters", () => {
    expect(newPasswordSchema.safeParse("123456789").success).toBe(false);
    expect(newPasswordSchema.safeParse("1234567890").success).toBe(true);
    expect(newPasswordSchema.safeParse("x".repeat(128)).success).toBe(true);
    expect(newPasswordSchema.safeParse("x".repeat(129)).success).toBe(false);
  });
});

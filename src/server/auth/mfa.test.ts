import { beforeAll, describe, expect, it } from "vitest";
import { openSecret, recoveryHash, sealSecret } from "./mfa";

beforeAll(() => { process.env.DATABASE_URL ??= "postgresql://cc_app:x@127.0.0.1:1/x"; process.env.AUTH_PEPPER ??= "unit-test-pepper-0123456789abcdef0123456789"; });

describe("stored two-step secrets", () => {
  it("decrypt only for the account they were sealed for, and not after tampering", () => {
    const sealed = sealSecret("JBSWY3DPEHPK3PXP", "user-a");
    expect(sealed).not.toContain("JBSWY3DPEHPK3PXP");
    expect(openSecret(sealed, "user-a")).toBe("JBSWY3DPEHPK3PXP");
    expect(() => openSecret(sealed, "user-b")).toThrow();
    const bad = Buffer.from(sealed, "base64"); bad[bad.length - 1] ^= 1;
    expect(() => openSecret(bad.toString("base64"), "user-a")).toThrow();
  });
  it("hashes a recovery code the same however it is typed", () => { expect(recoveryHash("ABCDE-FGHIJ")).toEqual(recoveryHash(" abcde fghij ")); });
});

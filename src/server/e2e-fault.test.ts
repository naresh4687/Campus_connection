import { afterEach, describe, expect, it, vi } from "vitest";
import { faultRoutesEnabled } from "./e2e-fault";

describe("deliberate-crash test pages", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("are off by default", () => {
    vi.stubEnv("E2E_FAULT_ROUTES", undefined);
    expect(faultRoutesEnabled()).toBe(false);
  });

  it("stay off for any value but the exact test-server one", () => {
    for (const v of ["1", "true", "yes", "e2e", " e2e-test-server-only", "E2E-TEST-SERVER-ONLY"]) {
      vi.stubEnv("E2E_FAULT_ROUTES", v);
      expect(faultRoutesEnabled(), v).toBe(false);
    }
  });

  it("turn on only for the Playwright test server's value", () => {
    vi.stubEnv("E2E_FAULT_ROUTES", "e2e-test-server-only");
    expect(faultRoutesEnabled()).toBe(true);
  });
});

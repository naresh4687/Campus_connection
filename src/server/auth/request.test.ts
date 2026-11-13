import { beforeEach, describe, expect, it, vi } from "vitest";

let hdrs: Record<string, string> = {};
vi.mock("next/headers", () => ({ headers: async () => ({ get: (k: string) => hdrs[k.toLowerCase()] ?? null }) }));

process.env.DATABASE_URL = "postgresql://x";
process.env.AUTH_PEPPER = "p".repeat(40);
process.env.AUTH_COOKIE_SECURE = "false";

describe("assertSameOrigin", () => {
  beforeEach(() => { hdrs = {}; });
  it("accepts a matching Origin", async () => {
    const { assertSameOrigin } = await import("./request");
    hdrs = { origin: "https://app.example.test", host: "app.example.test" };
    await expect(assertSameOrigin()).resolves.toBeUndefined();
  });
  it("rejects a different Origin, a lookalike host, and garbage", async () => {
    const { assertSameOrigin } = await import("./request");
    for (const origin of ["https://evil.test", "https://app.example.test.evil.test", "null", "not a url"]) {
      hdrs = { origin, host: "app.example.test" };
      await expect(assertSameOrigin()).rejects.toThrow(/Cross-origin/);
    }
  });
  it("treats the opaque 'null' Origin like a missing one: only Sec-Fetch-Site: same-origin is accepted", async () => {
    const { assertSameOrigin } = await import("./request");
    hdrs = { origin: "null", host: "app.example.test", "sec-fetch-site": "same-origin" };
    await expect(assertSameOrigin()).resolves.toBeUndefined();
    for (const site of ["cross-site", "same-site", "none", ""]) {
      hdrs = { origin: "null", host: "app.example.test", ...(site ? { "sec-fetch-site": site } : {}) };
      await expect(assertSameOrigin(), site || "(absent)").rejects.toThrow(/Cross-origin/);
    }
  });
  it("a concrete foreign Origin is refused even if Sec-Fetch-Site claims same-origin", async () => {
    const { assertSameOrigin } = await import("./request");
    hdrs = { origin: "https://evil.test", host: "app.example.test", "sec-fetch-site": "same-origin" };
    await expect(assertSameOrigin()).rejects.toThrow(/Cross-origin/);
  });
  it("without Origin, requires Sec-Fetch-Site: same-origin", async () => {
    const { assertSameOrigin } = await import("./request");
    hdrs = { host: "app.example.test" };
    await expect(assertSameOrigin()).rejects.toThrow();
    hdrs = { host: "app.example.test", "sec-fetch-site": "cross-site" };
    await expect(assertSameOrigin()).rejects.toThrow();
    hdrs = { host: "app.example.test", "sec-fetch-site": "same-origin" };
    await expect(assertSameOrigin()).resolves.toBeUndefined();
  });
});

describe("clientIp", () => {
  it("is null when no trusted proxy is configured, even if X-Forwarded-For is present (spoof-proof)", async () => {
    const { clientIp } = await import("./request");
    hdrs = { "x-forwarded-for": "1.2.3.4" };
    expect(await clientIp()).toBeNull();
  });
});

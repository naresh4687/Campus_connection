import { beforeAll, describe, expect, it, vi } from "vitest";

const COLLEGE = "11111111-2222-4333-8444-555555555555";
beforeAll(() => { vi.stubEnv("DATABASE_URL", "postgresql://x:y@localhost/z"); vi.stubEnv("AUTH_PEPPER", "unit-test-pepper-0123456789abcdef012345"); vi.stubEnv("AUTH_COOKIE_SECURE", "false"); });

describe("student sign-up link token", () => {
  it("round-trips and rejects any tampering with college, version or signature", async () => {
    const { joinToken, parseJoinToken } = await import("./link");
    const t = joinToken(COLLEGE, 3);
    expect(parseJoinToken(t)).toEqual({ college: COLLEGE, version: 3 });
    expect(parseJoinToken(t.replace(".3.", ".4."))).toBeNull();                                       // another version
    expect(parseJoinToken(t.replace("11111111", "11111112"))).toBeNull();                              // another college
    expect(parseJoinToken(t.slice(0, -1) + (t.endsWith("a") ? "b" : "a"))).toBeNull();                // a changed signature
    for (const bad of [undefined, "", "abc", `${COLLEGE}.1.`, `${COLLEGE}.x.${"a".repeat(32)}`, `${COLLEGE.toUpperCase()}.1.${t.split(".")[2]}`, `${t}extra`]) expect(parseJoinToken(bad as string)).toBeNull();
  });
  it("different colleges and versions give different tokens", async () => {
    const { joinToken } = await import("./link");
    expect(new Set([joinToken(COLLEGE, 1), joinToken(COLLEGE, 2), joinToken("aaaaaaaa-2222-4333-8444-555555555555", 1)]).size).toBe(3);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { classify } from "./dispatch";
import { pushConfig, resetPushConfigForTests } from "./config";
import { channelAvailability, availableChannels } from "../notifications/channels";
import { emailProvider } from "../email";

const KEYS = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"] as const;
afterEach(() => { vi.unstubAllEnvs(); resetPushConfigForTests(); });

describe("error classification", () => {
  it("expired endpoints stop; temporary trouble retries; permanent rejections fail", () => {
    expect(classify(404)).toBe("EXPIRED"); expect(classify(410)).toBe("EXPIRED");
    for (const s of [undefined, 408, 429, 500, 502, 503, 401, 403]) expect(classify(s), String(s)).toBe("RETRY");
    for (const s of [400, 413, 422]) expect(classify(s), String(s)).toBe("FAILED");
  });
});

describe("configuration never crashes the app", () => {
  it("missing keys: push is unavailable, nothing throws", () => {
    for (const k of KEYS) vi.stubEnv(k, ""); resetPushConfigForTests();
    expect(pushConfig()).toEqual({ ok: false, reason: "not configured" });
  });
  it("malformed keys are refused with a reason; valid ones are accepted", () => {
    vi.stubEnv("VAPID_PUBLIC_KEY", "short"); vi.stubEnv("VAPID_PRIVATE_KEY", "short"); vi.stubEnv("VAPID_SUBJECT", "nope"); resetPushConfigForTests();
    const bad = pushConfig(); expect(bad.ok).toBe(false);
    vi.stubEnv("VAPID_PUBLIC_KEY", "B" + "A".repeat(86)); vi.stubEnv("VAPID_PRIVATE_KEY", "A".repeat(43)); vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.org"); resetPushConfigForTests();
    expect(pushConfig().ok).toBe(true);
  });
});

describe("channels: the UI reflects what really works", () => {
  it("email is unavailable and no provider exists; in-app is always on; push follows its configuration", () => {
    for (const k of KEYS) vi.stubEnv(k, ""); resetPushConfigForTests();
    expect(emailProvider()).toBeNull();
    expect(channelAvailability()).toEqual({ inApp: true, push: false, email: false });
    expect(availableChannels()).toEqual(["IN_APP"]);
    vi.stubEnv("VAPID_PUBLIC_KEY", "B" + "A".repeat(86)); vi.stubEnv("VAPID_PRIVATE_KEY", "A".repeat(43)); vi.stubEnv("VAPID_SUBJECT", "mailto:ops@example.org"); resetPushConfigForTests();
    expect(availableChannels()).toEqual(["IN_APP", "PUSH"]);
  });
});

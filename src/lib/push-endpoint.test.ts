import { describe, expect, it } from "vitest";
import { isAllowedPushEndpoint } from "./push-endpoint";

describe("push endpoint allowlist (SSRF guard)", () => {
  it("accepts the real browser push services only", () => {
    for (const ok of ["https://fcm.googleapis.com/fcm/send/abc", "https://updates.push.services.mozilla.com/wpush/v2/abc", "https://web.push.apple.com/abc", "https://par02p.notify.windows.com/w/?token=1", "https://FCM.googleapis.com./x"]) expect(isAllowedPushEndpoint(ok), ok).toBe(true);
  });
  it("rejects other hosts, IPs, ports, credentials, plain http and junk", () => {
    for (const bad of ["https://evil.example/x", "http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://[::1]/x", "https://localhost/x", "https://169.254.169.254/latest/meta-data", "https://fcm.googleapis.com.evil.test/x", "https://evil.test/fcm.googleapis.com", "https://fcm.googleapis.com@evil.test/x", "https://user:pw@fcm.googleapis.com/x", "https://fcm.googleapis.com:8443/x", "https://notify.windows.com/x", "https://evilnotify.windows.com.evil.test/x", "ftp://fcm.googleapis.com/x", "javascript:alert(1)", "", "not a url", 5, null, "https://fcm.googleapis.com/" + "a".repeat(1000)]) expect(isAllowedPushEndpoint(bad), String(bad)).toBe(false);
  });
});

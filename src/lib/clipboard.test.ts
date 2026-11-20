import { afterEach, describe, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

// The unit environment is node, so the few browser globals copyText touches are stubbed.
function browser(o: { clipboard?: unknown; secure: boolean; exec: () => boolean }) {
  const el = () => ({ style: {} as Record<string, string>, value: "", focus: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), remove: vi.fn() });
  vi.stubGlobal("window", { isSecureContext: o.secure });
  vi.stubGlobal("navigator", { clipboard: o.clipboard });
  vi.stubGlobal("document", { createElement: vi.fn(el), body: { appendChild: vi.fn() }, execCommand: vi.fn(o.exec) });
}

describe("copyText", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the Clipboard API on a secure page", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    browser({ clipboard: { writeText }, secure: true, exec: () => false });
    expect(await copyText("https://x/join/abc")).toBe("copied");
    expect(writeText).toHaveBeenCalledWith("https://x/join/abc");
  });
  it("falls back to execCommand when the Clipboard API is missing (plain-http page)", async () => {
    browser({ clipboard: undefined, secure: false, exec: () => true });
    expect(await copyText("t")).toBe("copied");
  });
  it("does not use the Clipboard API on an insecure page even if present", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    browser({ clipboard: { writeText }, secure: false, exec: () => true });
    expect(await copyText("t")).toBe("copied");
    expect(writeText).not.toHaveBeenCalled();
  });
  it("falls back when clipboard permission is denied", async () => {
    browser({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) }, secure: true, exec: () => true });
    expect(await copyText("t")).toBe("copied");
  });
  it("reports unavailable, never a false success, when nothing works", async () => {
    browser({ clipboard: { writeText: vi.fn().mockRejectedValue(new Error("no")) }, secure: true, exec: () => false });
    expect(await copyText("t")).toBe("unavailable");
    browser({ clipboard: undefined, secure: false, exec: () => { throw new Error("blocked"); } });
    expect(await copyText("t")).toBe("unavailable");
  });
  it("copies from the visible field when given one", async () => {
    browser({ clipboard: undefined, secure: false, exec: () => true });
    const input = { focus: vi.fn(), select: vi.fn(), setSelectionRange: vi.fn(), style: {} } as unknown as HTMLInputElement;
    expect(await copyText("link", input)).toBe("copied");
    expect(input.select).toHaveBeenCalled(); expect(input.setSelectionRange).toHaveBeenCalledWith(0, 4);
  });
});

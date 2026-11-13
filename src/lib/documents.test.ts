import { describe, expect, it } from "vitest";
import { MAX_DOCUMENT_BYTES, fmtBytes, sanitizeFilename, sniffType, storageKey, validateUpload } from "./documents";

const text = (s: string) => new TextEncoder().encode(s);
const cat = (...parts: Uint8Array[]) => { const out = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
const pdf = (body = "1 0 obj <<>> endobj") => text(`%PDF-1.7\n${body}\n%%EOF\n`);
const png = () => cat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), new Uint8Array(40), text("IEND"), new Uint8Array([0xae, 0x42, 0x60, 0x82]));
const jpg = () => cat(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), new Uint8Array(100), new Uint8Array([0xff, 0xd9]));

describe("sniffType (by content, not by name)", () => {
  it("recognises complete PDF, PNG and JPEG files", () => {
    expect(sniffType(pdf())).toBe("application/pdf");
    expect(sniffType(png())).toBe("image/png");
    expect(sniffType(jpg())).toBe("image/jpeg");
  });
  it.each([
    ["an HTML page", text("<html><script>alert(1)</script></html>")], ["an SVG", text('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>')], ["plain text", text("hello")],
    ["an empty file", new Uint8Array()], ["a zip/docx (PK)", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])], ["a Windows executable (MZ)", new Uint8Array([0x4d, 0x5a, 0x90, 0])],
    ["a shell script", text("#!/bin/sh\nrm -rf /\n")], ["a GIF", text("GIF89a......")],
  ])("rejects %s", (_l, bytes) => { expect(sniffType(bytes)).toBeNull(); });
  it("rejects truncated files (missing end markers)", () => {
    expect(sniffType(text("%PDF-1.7\n1 0 obj"))).toBeNull();
    expect(sniffType(png().subarray(0, 30))).toBeNull();
    expect(sniffType(jpg().subarray(0, 50))).toBeNull();
  });
  it("does not accept a file merely because its start is a signature hidden mid-file", () => {
    expect(sniffType(cat(text("junk"), pdf()))).toBeNull();
    expect(sniffType(cat(text("<html>"), png()))).toBeNull();
  });
});

describe("sanitizeFilename", () => {
  it.each([
    ["../../etc/passwd", "passwd"], ["C:\\Users\\me\\resume.pdf", "resume.pdf"], ["a/b/c.png", "c.png"], [".htaccess", "htaccess"], ["...hidden.pdf", "hidden.pdf"],
    ["bad\u0007name\u0000.pdf", "badname.pdf"], ["  spaced   out .pdf ", "spaced out .pdf"], ["", "document.pdf"], ["///", "document.pdf"], ["résumé 2026.pdf", "résumé 2026.pdf"],
  ])("%j -> %j", (input, expected) => { expect(sanitizeFilename(input)).toBe(expected); });
  it("caps length at 120 while keeping the extension", () => {
    const n = sanitizeFilename("x".repeat(300) + ".pdf");
    expect(n.length).toBe(120);
    expect(n.endsWith(".pdf")).toBe(true);
  });
  it("never contains path or control characters", () => {
    for (const raw of ["a\\b/c", "\u202Egpj.exe", "tab\tname.pdf", "new\nline.pdf"]) expect(sanitizeFilename(raw)).not.toMatch(/[\u0000-\u001F\u007F/\\]/);
  });
});

describe("validateUpload", () => {
  const ok = (over: Partial<Parameters<typeof validateUpload>[0]> = {}) => validateUpload({ filename: "sem5.pdf", declaredType: "application/pdf", bytes: pdf(), kind: "MARKSHEET", ...over });
  it("accepts a valid file and returns the sniffed type and a safe name", () => {
    expect(ok()).toEqual({ ok: true, type: "application/pdf", name: "sem5.pdf" });
    expect(ok({ filename: "Photo.JPEG", declaredType: "image/jpeg", bytes: jpg() })).toMatchObject({ ok: true, type: "image/jpeg" });
    expect(ok({ filename: "scan.png", declaredType: "", bytes: png() })).toMatchObject({ ok: true, type: "image/png" });
    expect(ok({ declaredType: "application/octet-stream" })).toMatchObject({ ok: true });
  });
  it("refuses an unknown kind, an empty file and an oversized file", () => {
    expect(ok({ kind: "SELFIE" })).toMatchObject({ ok: false });
    expect(ok({ bytes: new Uint8Array() })).toMatchObject({ ok: false, message: "The file is empty." });
    expect(ok({ bytes: new Uint8Array(MAX_DOCUMENT_BYTES + 1) })).toMatchObject({ ok: false, message: expect.stringMatching(/larger than 5 MB/) });
  });
  it("refuses content that is not PDF/PNG/JPEG whatever the name or declared type says", () => {
    expect(ok({ filename: "evil.pdf", declaredType: "application/pdf", bytes: text("<html>") })).toMatchObject({ ok: false, message: expect.stringMatching(/Only PDF, PNG and JPEG/) });
    expect(ok({ filename: "evil.png", declaredType: "image/png", bytes: new Uint8Array([0x4d, 0x5a, 0, 0]) })).toMatchObject({ ok: false });
  });
  it("refuses a name whose extension disagrees with the content", () => {
    expect(ok({ filename: "marks.png" })).toMatchObject({ ok: false, message: expect.stringMatching(/ends in “\.png”.*PDF/) });
    expect(ok({ filename: "marks" })).toMatchObject({ ok: false });
    expect(ok({ filename: "marks.pdf.exe" })).toMatchObject({ ok: false });
  });
  it("refuses when the browser-declared type contradicts the content", () => {
    expect(ok({ declaredType: "image/png" })).toMatchObject({ ok: false, message: expect.stringMatching(/declared type/) });
  });
  it("strips directories from the stored name", () => {
    expect(ok({ filename: "../../x/marks.pdf" })).toMatchObject({ ok: true, name: "marks.pdf" });
  });
});

describe("helpers", () => {
  it("storageKey has the exact shape the database enforces", () => {
    const k = storageKey("11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333");
    expect(k).toMatch(/^c\/[0-9a-f-]{36}\/s\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  });
  it("fmtBytes", () => { expect(fmtBytes(500)).toBe("1 KB"); expect(fmtBytes(120_000)).toBe("117 KB"); expect(fmtBytes(2.5 * 1024 * 1024)).toBe("2.5 MB"); });
});

import { describe, expect, it } from "vitest";
import { classifyLinks, registrationView, sniffImage, validateEvidence } from "./evidence";

const png = (extra = 0) => { const b = new Uint8Array(100 + extra); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); b.set([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], b.length - 8); return b; };
const webp = (ok = true) => { const b = new Uint8Array(40); b.set([0x52, 0x49, 0x46, 0x46], 0); const size = ok ? 32 : 99; b[4] = size; b.set([0x57, 0x45, 0x42, 0x50], 8); return b; };

describe("screenshot validation", () => {
  it("accepts a complete PNG and WebP by content, whatever the name says to the browser", () => {
    expect(sniffImage(png())).toBe("image/png"); expect(sniffImage(webp())).toBe("image/webp");
    expect(validateEvidence({ filename: "shot.png", declaredType: "image/png", bytes: png() })).toMatchObject({ ok: true, type: "image/png" });
  });
  it("refuses a PDF renamed to .png, a cut-off image, an empty file, a wrong extension and a mismatched declared type", () => {
    const pdf = new TextEncoder().encode("%PDF-1.4 ... %%EOF");
    expect(validateEvidence({ filename: "a.png", declaredType: "image/png", bytes: pdf }).ok).toBe(false);
    expect(validateEvidence({ filename: "a.png", declaredType: "image/png", bytes: png().subarray(0, 50) }).ok).toBe(false);
    expect(validateEvidence({ filename: "a.png", declaredType: "image/png", bytes: new Uint8Array() }).ok).toBe(false);
    expect(validateEvidence({ filename: "a.jpg", declaredType: "image/png", bytes: png() }).ok).toBe(false);
    expect(validateEvidence({ filename: "a.png", declaredType: "image/jpeg", bytes: png() }).ok).toBe(false);
    expect(sniffImage(webp(false))).toBeNull();
  });
  it("neutralises path tricks in the file name", () => {
    const r = validateEvidence({ filename: "..\\..\\etc/passwd.png", declaredType: "", bytes: png() });
    expect(r.ok && r.name).toBe("passwd.png");
  });
  it("refuses an image over the size limit", () => { expect(validateEvidence({ filename: "a.png", declaredType: "", bytes: png(5 * 1024 * 1024) }).ok).toBe(false); });
});

describe("what the student sees", () => {
  it("keeps CampusConnect registration and external verification apart", () => {
    expect(registrationView({ status: "REGISTERED", method: "INTERNAL" }).label).toBe("Registered");
    expect(registrationView({ status: "PENDING_EXTERNAL", method: "EXTERNAL", evidence_status: "NOT_SUBMITTED" }).label).toBe("External registration pending");
    expect(registrationView({ status: "REGISTERED", method: "EXTERNAL", evidence_status: "SUBMITTED_PENDING_REVIEW" }).label).toBe("Registered — evidence pending review");
    expect(registrationView({ status: "REGISTERED", method: "EXTERNAL", evidence_status: "VERIFIED" }).label).toBe("Registered — evidence verified");
    for (const e of ["REJECTED", "RESUBMISSION_REQUIRED"]) expect(registrationView({ status: "REGISTERED", method: "EXTERNAL", evidence_status: e }).next).toBeTruthy();
    expect(registrationView({ status: "WITHDRAWN", method: "EXTERNAL", evidence_status: "VERIFIED" }).label).toBe("Not registered");
  });
});

describe("link purposes in a company message", () => {
  const msg = `Zooye is hiring.\nVisit our website: https://zooye.example.com\nKnow more: https://zooye.example.com/careers/wordpress.pdf\nApply here: https://forms.gle/abc123 before 20/11.\nhttps://example.org/news`;
  it("separates the registration form from information pages, and says why", () => {
    const l = Object.fromEntries(classifyLinks(msg).map((x) => [x.url, x.purpose]));
    expect(l["https://forms.gle/abc123"]).toBe("REGISTRATION_FORM");
    expect(l["https://zooye.example.com"]).toBe("COMPANY_WEBSITE");
    expect(l["https://zooye.example.com/careers/wordpress.pdf"]).toBe("JOB_DESCRIPTION");
    expect(l["https://example.org/news"]).toBe("OTHER");
  });
  it("never treats a plain company site as a registration link", () => { expect(classifyLinks("Details at https://acme.example.com")[0].purpose).not.toBe("REGISTRATION_FORM"); });
});

/**
 * External registration: shared (client-safe) rules for the confirmation screenshot and the words the app uses for each state.
 * The file is identified by its CONTENT (signature + a complete ending), never by its name or the browser's declared type.
 */
export const MAX_EVIDENCE_MB = 4;                       // kept under the host's 4.5 MB request-body limit, so a passing file is never cut off
export const MAX_EVIDENCE_BYTES = MAX_EVIDENCE_MB * 1024 * 1024;
export type EvidenceType = "image/png" | "image/jpeg" | "image/webp";
const EXT: Record<EvidenceType, string[]> = { "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"], "image/webp": ["webp"] };
export const EVIDENCE_TYPE_LABEL: Record<EvidenceType, string> = { "image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WebP" };

const starts = (b: Uint8Array, sig: number[], at = 0) => b.length >= at + sig.length && sig.every((v, i) => b[at + i] === v);
const has = (hay: Uint8Array, needle: number[]) => { for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((v, j) => hay[i + j] === v)) return true; return false; };
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));

export function sniffImage(bytes: Uint8Array): EvidenceType | null {
  if (starts(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return has(bytes.subarray(Math.max(0, bytes.length - 32)), ascii("IEND")) ? "image/png" : null;
  if (starts(bytes, [0xff, 0xd8, 0xff])) return has(bytes.subarray(Math.max(0, bytes.length - 64)), [0xff, 0xd9]) ? "image/jpeg" : null;
  if (starts(bytes, ascii("RIFF")) && starts(bytes, ascii("WEBP"), 8)) {
    const declared = (bytes[4] | (bytes[5] << 8) | (bytes[6] << 16) | (bytes[7] << 24)) >>> 0;       // RIFF size = file size - 8: a cut-off file does not add up
    return declared + 8 === bytes.length || declared + 9 === bytes.length ? "image/webp" : null;
  }
  return null;
}

export function safeImageName(raw: string, ext: string): string {
  let name = raw.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (!name) name = `screenshot.${ext}`;
  if (name.length > 120) { const dot = name.lastIndexOf("."); const e = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : ""; name = name.slice(0, 120 - e.length) + e; }
  return name;
}

export type EvidenceCheck = { ok: true; type: EvidenceType; name: string } | { ok: false; message: string };
export function validateEvidence(input: { filename: string; declaredType: string; bytes: Uint8Array }): EvidenceCheck {
  if (input.bytes.byteLength === 0) return { ok: false, message: "The file is empty." };
  if (input.bytes.byteLength > MAX_EVIDENCE_BYTES) return { ok: false, message: `The screenshot is larger than ${MAX_EVIDENCE_MB} MB. Take it again at a lower size, or crop it.` };
  const type = sniffImage(input.bytes);
  if (!type) return { ok: false, message: "Upload a complete PNG, JPEG or WebP image. PDFs, documents and damaged images are not accepted." };
  const name = safeImageName(input.filename, EXT[type][0]);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!EXT[type].includes(ext)) return { ok: false, message: `The file’s name ends in “.${ext || "(none)"}” but it is a ${EVIDENCE_TYPE_LABEL[type]} image. Rename it with the correct ending.` };
  const declared = input.declaredType.split(";")[0].trim().toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== type) return { ok: false, message: "The file’s declared type does not match its content." };
  return { ok: true, type, name };
}

export type RegState = { status: string | null; method?: string | null; evidence_status?: string | null };
/** The words a student sees, and what to do next. CampusConnect registration and external verification are always shown as two separate facts. */
export function registrationView(r: RegState): { label: string; tone: string; next: string | null } {
  if (!r.status || r.status === "WITHDRAWN") return { label: "Not registered", tone: "NOT_STARTED", next: null };
  if (r.method !== "EXTERNAL") return { label: "Registered", tone: "APPROVED", next: null };
  switch (r.status === "PENDING_EXTERNAL" ? "PENDING" : r.evidence_status) {
    case "PENDING": return { label: "External registration pending", tone: "PENDING", next: "Finish the company’s form, then upload a screenshot of its confirmation page." };
    case "SUBMITTED_PENDING_REVIEW":   // the screenshot is proof on file; nobody reviews it
    case "VERIFIED": return { label: "Registered", tone: "APPROVED", next: null };
    case "REJECTED": return { label: "Action required — upload a new screenshot", tone: "REJECTED", next: "Your screenshot was not accepted. Read the reason below and upload a new one." };
    case "RESUBMISSION_REQUIRED": return { label: "Action required — upload a new screenshot", tone: "REJECTED", next: "Staff asked for a new screenshot. Read the reason below and upload it." };
    default: return { label: "Registered", tone: "APPROVED", next: null };
  }
}
export const EVIDENCE_LABEL: Record<string, string> = { NOT_SUBMITTED: "Not submitted", SUBMITTED_PENDING_REVIEW: "On file", VERIFIED: "On file", REJECTED: "Rejected", RESUBMISSION_REQUIRED: "New screenshot requested", SUPERSEDED: "Replaced" };

/** What each link in a company message is for. A guess from the address and the words around it: staff must confirm before it is used for registration. */
export type LinkPurpose = "REGISTRATION_FORM" | "COMPANY_WEBSITE" | "JOB_DESCRIPTION" | "OTHER";
export const LINK_PURPOSE_LABEL: Record<LinkPurpose, string> = { REGISTRATION_FORM: "Looks like a registration form", COMPANY_WEBSITE: "Company website", JOB_DESCRIPTION: "Job description or information page", OTHER: "Other link" };
export function classifyLinks(text: string): { url: string; purpose: LinkPurpose; why: string }[] {
  const seen = new Set<string>(); const out: { url: string; purpose: LinkPurpose; why: string }[] = [];
  for (const m of text.matchAll(/https?:\/\/[^\s<>"']+/g)) {
    const url = m[0].replace(/[.,;:!?)\]]+$/, ""); if (seen.has(url)) continue; seen.add(url);
    const around = text.slice(Math.max(0, (m.index ?? 0) - 90), (m.index ?? 0)).toLowerCase();
    const lower = url.toLowerCase();
    const formBuilder = /forms\.gle\/|docs\.google\.com\/forms|forms\.office\.com|forms\.microsoft\.com|typeform\.com|airtable\.com\/shr|tally\.so|jotform\.com|surveymonkey\.com|zohopublic|forms\.zoho/.test(lower);
    if (formBuilder || /\/(apply|register|registration|application)\b/i.test(url) || /(apply|register|registration|application form|fill)[^\n]{0,40}$/.test(around)) out.push({ url, purpose: "REGISTRATION_FORM", why: /(apply|register|registration|form|fill)/.test(around) ? "A form address, with words about applying or registering just before it." : "A form-builder or application address." });
    else if (/\b(jd|job description|job details|know more|more details|about)\b/.test(around) || /\.pdf($|\?)/i.test(url) || /\/(jobs?|careers?|openings?)\b/i.test(url)) out.push({ url, purpose: "JOB_DESCRIPTION", why: "Described as, or shaped like, a job description or careers page." });
    else if (/\b(website|visit|web site|site)\b/.test(around)) out.push({ url, purpose: "COMPANY_WEBSITE", why: "Introduced as the company’s website." });
    else out.push({ url, purpose: "OTHER", why: "Nothing in the message says what this link is for." });
  }
  return out;
}

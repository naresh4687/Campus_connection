export const DOC_KINDS = [
  { value: "RESUME", label: "Resume", hint: "Your CV. Visible only to you until you apply to a drive." },
  { value: "MARKSHEET", label: "Mark sheet", hint: "Semester or year mark sheets. Your department coordinator can review them." },
  { value: "CERTIFICATE", label: "Certificate", hint: "Course, achievement or other certificates. Your department coordinator can review them." },
  { value: "OTHER", label: "Other college-approved document", hint: "Any other document your college asks for. Your department coordinator can review it." },
] as const;
export type DocKind = (typeof DOC_KINDS)[number]["value"];
export const kindLabel = (k: string) => DOC_KINDS.find((d) => d.value === k)?.label ?? k;

/** Kept under Vercel's 4.5 MB request-body limit, so an upload that passes this check is never cut off by the host. */
export const MAX_DOCUMENT_MB = 4;
export const MAX_DOCUMENT_BYTES = MAX_DOCUMENT_MB * 1024 * 1024;
export const MAX_ACTIVE_DOCUMENTS = 25;
export const DOWNLOAD_LINK_SECONDS = 60;

export type DocType = "application/pdf" | "image/png" | "image/jpeg";
const EXTENSIONS: Record<DocType, string[]> = { "application/pdf": ["pdf"], "image/png": ["png"], "image/jpeg": ["jpg", "jpeg"] };
export const TYPE_LABEL: Record<string, string> = { "application/pdf": "PDF", "image/png": "PNG image", "image/jpeg": "JPEG image" };

const startsWith = (b: Uint8Array, sig: number[]) => b.length >= sig.length && sig.every((v, i) => b[i] === v);
const tail = (b: Uint8Array, n: number) => b.subarray(Math.max(0, b.length - n));
const includesBytes = (hay: Uint8Array, needle: number[]) => {
  for (let i = 0; i + needle.length <= hay.length; i++) if (needle.every((v, j) => hay[i + j] === v)) return true;
  return false;
};
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));

/**
 * Identifies the file by its CONTENT, never by its name or the browser-declared type. Also rejects obviously truncated files
 * (a PDF without %%EOF, a PNG without IEND, a JPEG without an end marker).
 */
export function sniffType(bytes: Uint8Array): DocType | null {
  if (startsWith(bytes, ascii("%PDF-"))) return includesBytes(tail(bytes, 1024), ascii("%%EOF")) ? "application/pdf" : null;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return includesBytes(tail(bytes, 32), ascii("IEND")) ? "image/png" : null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return includesBytes(tail(bytes, 64), [0xff, 0xd9]) ? "image/jpeg" : null;
  return null;
}

/** A safe display name: no directories, control characters or leading dots; at most 120 characters; never empty. */
export function sanitizeFilename(raw: string, fallbackExt = "pdf"): string {
  let name = raw.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001F\u007F]/g, "").replace(/\s+/g, " ").trim().replace(/^\.+/, "");
  if (!name) name = `document.${fallbackExt}`;
  if (name.length > 120) {
    const dot = name.lastIndexOf(".");
    const ext = dot > 0 && name.length - dot <= 10 ? name.slice(dot) : "";
    name = name.slice(0, 120 - ext.length) + ext;
  }
  return name;
}

export type UploadCheck = { ok: true; type: DocType; name: string } | { ok: false; message: string };

export function validateUpload(input: { filename: string; declaredType: string; bytes: Uint8Array; kind: string }): UploadCheck {
  if (!DOC_KINDS.some((k) => k.value === input.kind)) return { ok: false, message: "Choose what kind of document this is." };
  if (input.bytes.byteLength === 0) return { ok: false, message: "The file is empty." };
  if (input.bytes.byteLength > MAX_DOCUMENT_BYTES) return { ok: false, message: `The file is larger than ${MAX_DOCUMENT_BYTES / 1024 / 1024} MB.` };
  const type = sniffType(input.bytes);
  if (!type) return { ok: false, message: "Only PDF, PNG and JPEG files are accepted, and the file must be complete and not corrupted." };
  const name = sanitizeFilename(input.filename, EXTENSIONS[type][0]);
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  if (!EXTENSIONS[type].includes(ext)) return { ok: false, message: `The file’s name ends in “.${ext || "(none)"}” but its content is a ${TYPE_LABEL[type]}. Rename it with the correct extension.` };
  const declared = input.declaredType.split(";")[0].trim().toLowerCase();
  if (declared && declared !== "application/octet-stream" && declared !== type) return { ok: false, message: "The file’s declared type does not match its content." };
  return { ok: true, type, name };
}

/** Server-generated storage key. The student never influences it. */
export const storageKey = (collegeId: string, studentId: string, objectId: string) => `c/${collegeId}/s/${studentId}/${objectId}`;

export const fmtBytes = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

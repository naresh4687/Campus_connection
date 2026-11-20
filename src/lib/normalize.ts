/**
 * The single place that decides what an identifier looks like. The database repeats the rule for identifiers (app.canon_identifier, migration 0029),
 * so a value written by any path ends up the same; these functions let the app compare, search and validate before it gets there.
 *
 * Identifiers and codes: NFKC, trimmed, upper-cased. Internal separators (/ . _ -) are kept: "23-AI/001" and "23AI001" are different identifiers.
 * Emails: trimmed, lower-cased. Names, company names, messages, URLs and enums are deliberately NOT handled here: they keep the case people wrote.
 */
const HAS_SPACE = /\s/;

/** Canonical form of an institutional identifier. Returns null for anything that is not a non-empty string. */
export function canonicalIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.normalize("NFKC").trim();
  return v === "" ? null : v.toUpperCase();
}

const REGISTER_RE = /^[A-Z0-9][A-Z0-9/._-]{2,29}$/;
const CODE_RE = /^[A-Z0-9][A-Z0-9&/._-]{0,29}$/;

function identifier(value: unknown, re: RegExp): string | null {
  const v = canonicalIdentifier(value);
  return v !== null && !HAS_SPACE.test(v) && re.test(v) ? v : null;
}

/** "23ai000" -> "23AI000". Null when the value is not a valid register number (3-30 letters, digits or / . _ -). */
export const normalizeStudentRegistrationNumber = (value: unknown) => identifier(value, REGISTER_RE);
export const normalizeAdmissionNumber = (value: unknown) => identifier(value, REGISTER_RE);
export const normalizeRollNumber = (value: unknown) => identifier(value, REGISTER_RE);
/** "ai&ds" -> "AI&DS", "cse" -> "CSE", "cc1" -> "CC1". */
export const normalizeDepartmentCode = (value: unknown) => identifier(value, CODE_RE);
export const normalizeBatchCode = (value: unknown) => identifier(value, CODE_RE);
export const normalizeCourseCode = (value: unknown) => identifier(value, CODE_RE);
export const normalizeSectionCode = (value: unknown) => identifier(value, CODE_RE);

/** For text a person is still typing or a search box: canonical when it can be, otherwise just trimmed and upper-cased. Never throws. */
export const looseIdentifier = (value: unknown): string => canonicalIdentifier(value) ?? "";

/** "Student@Example.COM " -> "student@example.com". Returns null for non-strings and empty text; the address itself is validated elsewhere. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.normalize("NFKC").trim().toLowerCase();
  return v === "" ? null : v;
}

/** Equality of two identifiers regardless of how each was typed. Two missing values are never equal. */
export function sameIdentifier(a: unknown, b: unknown): boolean {
  const x = canonicalIdentifier(a); const y = canonicalIdentifier(b);
  return x !== null && x === y;
}

/** For an identifier <input>: shows the canonical (upper-case) form as the person types. The server still normalizes on its own. */
export function upperInput(e: { currentTarget: { value: string; selectionStart: number | null; selectionEnd: number | null; setSelectionRange?: (a: number, b: number) => void } }) {
  const el = e.currentTarget; const { selectionStart: a, selectionEnd: b } = el; const up = el.value.toUpperCase();
  if (up !== el.value) { el.value = up; el.setSelectionRange?.(a ?? up.length, b ?? up.length); }
}

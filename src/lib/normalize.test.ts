import { describe, expect, it } from "vitest";
import { canonicalIdentifier, looseIdentifier, normalizeBatchCode, normalizeDepartmentCode, normalizeEmail, normalizeStudentRegistrationNumber, sameIdentifier } from "./normalize";

describe("identifier normalization", () => {
  it("every casing of a register number resolves to one canonical value", () => {
    for (const v of ["23ai000", "23AI000", "23Ai000", "  23aI000\t", "２３ａｉ０００"]) expect(normalizeStudentRegistrationNumber(v)).toBe("23AI000");
  });
  it("separators are kept: different characters mean a different identifier", () => {
    expect(normalizeStudentRegistrationNumber("23-ai/001")).toBe("23-AI/001");
    expect(sameIdentifier("23-AI001", "23AI001")).toBe(false);
    expect(sameIdentifier("23ai001", "23AI001")).toBe(true);
  });
  it("codes keep their meaningful characters", () => {
    expect(normalizeDepartmentCode("ai&ds")).toBe("AI&DS"); expect(normalizeDepartmentCode("cse")).toBe("CSE"); expect(normalizeBatchCode("cc1")).toBe("CC1");
  });
  it("invalid or non-text input is refused, never coerced", () => {
    for (const v of [null, undefined, 12, {}, "", "   ", "ab", "a b c d", "23AI 000", "x".repeat(40), "-23AI000"]) expect(normalizeStudentRegistrationNumber(v)).toBeNull();
    expect(canonicalIdentifier(null)).toBeNull(); expect(looseIdentifier(undefined)).toBe("");
  });
  it("emails are lower-cased and trimmed; names, companies and URLs are not identifiers", () => {
    expect(normalizeEmail("  Student@Example.COM ")).toBe("student@example.com"); expect(normalizeEmail(5)).toBeNull();
  });
  it("two missing values are not equal", () => { expect(sameIdentifier(null, null)).toBe(false); expect(sameIdentifier("", "  ")).toBe(false); });
});

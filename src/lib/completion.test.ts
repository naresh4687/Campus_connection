import { describe, expect, it } from "vitest";
import { COMPLETION_BANDS, COMPLETION_ITEMS, completionScore, missingItems } from "./completion";

const none = { contact: false, academics: false, semesters: false, document: false, career: false, achievement: false };
describe("profile completion", () => {
  it("weights add up to exactly 100 and every item has a place to act", () => {
    expect(COMPLETION_ITEMS.reduce((n, i) => n + i.weight, 0)).toBe(100);
    for (const i of COMPLETION_ITEMS) expect(i.href).toMatch(/^\/student\//);
  });
  it("scores each item by its weight; nothing done is 0, everything done is 100", () => {
    expect(completionScore(none)).toBe(0);
    expect(completionScore({ ...none, academics: true })).toBe(40);
    expect(completionScore({ contact: true, academics: true, semesters: true, document: true, career: true, achievement: true })).toBe(100);
  });
  it("lists exactly what is missing", () => {
    expect(missingItems({ ...none, contact: true, academics: true }).map((i) => i.key)).toEqual(["semesters", "document", "career", "achievement"]);
  });
  it("bands cover 0-100 without gaps or overlaps", () => {
    const b = Object.values(COMPLETION_BANDS).sort((x, y) => x.min - y.min);
    expect(b[0].min).toBe(0); expect(b.at(-1)!.max).toBe(100);
    for (let i = 1; i < b.length; i++) expect(b[i].min).toBe(b[i - 1].max + 1);
  });
});

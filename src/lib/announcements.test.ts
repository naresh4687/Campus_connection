import { describe, expect, it } from "vitest";
import { batchesToText, contentSchema, displayStatus, istToIso, isoToIstInput, parseBatches, parseRegisterNumbers, parseStages, parseYears, toDbFields, warnings } from "./announcements";
import { formatMessage } from "./message-format";

const base = { kind: "TRAINING_VENUE", title: "Cloud training venue", priority: "NORMAL", display_mode: "SUMMARY" };

describe("message formatting", () => {
  it("keeps lines, numbering and emojis; recognises bold, italic, strike and links", () => {
    const m = formatMessage("*Final Year Training* 🎓\n1. Batch 1: CC1\n\nSee _notes_ at https://example.com/a_b_c.\n~old~");
    expect(m).toHaveLength(5);
    expect(m[0]).toEqual([{ t: "bold", v: "Final Year Training" }, { t: "text", v: " 🎓" }]);
    expect(m[1]).toEqual([{ t: "text", v: "1. Batch 1: CC1" }]);
    expect(m[2]).toEqual([{ t: "text", v: "" }]);
    expect(m[3]).toEqual([{ t: "text", v: "See " }, { t: "italic", v: "notes" }, { t: "text", v: " at " }, { t: "link", v: "https://example.com/a_b_c", href: "https://example.com/a_b_c" }, { t: "text", v: "." }]);
    expect(m[4]).toEqual([{ t: "strike", v: "old" }]);
  });
  it("leaves stray marks, multiplication signs and snake_case alone", () => {
    for (const s of ["2*3*4 = 24", "use snake_case_names here", "a * b", "5 * 6 and 7 * 8", "price is ₹50,000*"]) expect(formatMessage(s)[0].map((x) => x.v).join(""), s).toBe(s);
    expect(formatMessage("2*3*4 = 24")[0].every((x) => x.t === "text")).toBe(true);
  });
  it("never produces markup: HTML stays text and only http(s) links become links", () => {
    const m = formatMessage("<script>alert(1)</script> javascript:alert(1) http://a.test/x");
    expect(m[0].filter((x) => x.t === "link").map((x) => x.v)).toEqual(["http://a.test/x"]);
    expect(m[0].map((x) => x.v).join("")).toContain("<script>alert(1)</script>");
  });
  it("trims trailing punctuation from a link and handles CRLF", () => {
    expect(formatMessage("Register: https://forms.example/abc).")[0].filter((x) => x.t === "link")[0]).toMatchObject({ v: "https://forms.example/abc" });
    expect(formatMessage("a\r\nb")).toHaveLength(2);
  });
});

describe("announcement form", () => {
  it("accepts a minimal valid form and rejects a bad type, title, link and date", () => {
    expect(contentSchema.safeParse(base).success).toBe(true);
    expect(contentSchema.safeParse({ ...base, kind: "DRIVE" }).success).toBe(false);
    expect(contentSchema.safeParse({ ...base, title: "ab" }).success).toBe(false);
    expect(contentSchema.safeParse({ ...base, action_link: "javascript:alert(1)" }).success).toBe(false);
    expect(contentSchema.safeParse({ ...base, event_date: "2026-02-30" }).success).toBe(false);
    expect(contentSchema.safeParse({ ...base, consent_deadline: "tomorrow" }).success).toBe(false);
  });
  it("reads India time and shows it back", () => {
    expect(istToIso("2026-11-18T09:10")).toBe("2026-11-18T03:40:00.000Z");
    expect(isoToIstInput("2026-11-18T03:40:00.000Z")).toBe("2026-11-18T09:10");
    expect(istToIso("18/11/2026")).toBeNull();
  });
  it("sends only the fields that apply to the type and clears the rest", () => {
    const c = contentSchema.parse({ ...base, kind: "GENERAL", venue: "Hall 1", stages: "Round 1", batches: "Batch 1 | CC1", event_date: "2026-11-18" });
    const { fields } = toDbFields(c);
    expect(fields).toMatchObject({ venue: null, stages: [], batches: [], event_date: "2026-11-18" });
    const t = toDbFields(contentSchema.parse({ ...base, batches: "Batch 1 | CC1 and CC2\nBatch 2 | CC3 and CC4" })).fields;
    expect(t.batches).toEqual([{ name: "Batch 1", venue: "CC1 and CC2", note: null }, { name: "Batch 2", venue: "CC3 and CC4", note: null }]);
  });
  it("keeps each batch with its own venue, and refuses a line without one", () => {
    expect(parseBatches("Batch 1 | CC1 & CC2 | bring ID").ok[0]).toEqual({ name: "Batch 1", venue: "CC1 & CC2", note: "bring ID" });
    expect(parseBatches("Batch 1").bad).toEqual(["Batch 1"]);
    expect(toDbFields(contentSchema.parse({ ...base, batches: "Batch 1" })).error).toMatch(/own venue/);
    expect(batchesToText(parseBatches("Batch 1 | CC1\nBatch 2 | CC3").ok)).toBe("Batch 1 | CC1\nBatch 2 | CC3");
  });
  it("parses stages, years and register numbers", () => {
    expect(parseStages("- Pre Placement Talk\n1. Online Test\n\nFinal Round: HR")).toEqual(["Pre Placement Talk", "Online Test", "Final Round: HR"]);
    expect(parseYears("2026, 2027")).toEqual([2026, 2027]); expect(parseYears("26")).toBeNull(); expect(parseYears("")).toEqual([]);
    expect(parseRegisterNumbers("A1, a2;A1\nB3")).toEqual(["A1", "A2", "B3"]);
  });
  it("derives Updated and Expired without storing them, and warns without changing a value", () => {
    const now = Date.parse("2026-11-18T00:00:00Z");
    expect(displayStatus({ status: "PUBLISHED", version: 2, expires_at: null }, now)).toBe("UPDATED");
    expect(displayStatus({ status: "PUBLISHED", version: 2, expires_at: "2026-11-01T00:00:00Z" }, now)).toBe("EXPIRED");
    expect(displayStatus({ status: "DRAFT", version: 1, expires_at: null }, now)).toBe("DRAFT");
    expect(warnings({ event_date: "2026-11-01" }, now)).toContain("The event date is in the past.");
    expect(warnings({ event_date: "2026-11-22" }, now)).toContain("The event date is a Sunday. Check it.");
    expect(warnings({ event_date: "2026-11-24" }, now)).toEqual([]);
  });
});

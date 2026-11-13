import { describe, expect, it } from "vitest";
import { extractionSchema, parseModelJson, toFormValues, verifyExtraction, type Extraction } from "./ai-extract";

const TEXT = `Acme Robotics is hiring Graduate Engineer Trainees at Pune (full-time). CTC: 6.5 LPA. 10 openings.
Eligibility: B.E. CSE and ECE, 2026 batch, minimum 7.5 CGPA, 60% in 10th, no active backlogs.
Last date to apply: 2099-03-04 17:00 IST.`;
const ex = (over: Record<string, unknown> = {}): Extraction => extractionSchema.parse({
  company: { value: "Acme Robotics", quote: "Acme Robotics is hiring" }, title: { value: "Graduate Engineer Trainee", quote: "Graduate Engineer Trainees" }, location: { value: "Pune", quote: "at Pune" },
  employmentType: { value: "FULL_TIME", quote: "(full-time)" }, ctcLpa: { value: 6.5, quote: "CTC: 6.5 LPA" }, openings: { value: 10, quote: "10 openings" },
  deadline: { value: "2099-03-04T17:00", quote: "Last date to apply: 2099-03-04 17:00 IST" }, minCgpa: { value: 7.5, quote: "minimum 7.5 CGPA" }, minTenth: { value: 60, quote: "60% in 10th" },
  maxBacklogs: { value: 0, quote: "no active backlogs" }, passingYears: { value: [2026], quote: "2026 batch" }, departments: { value: ["CSE", "ECE"], quote: "B.E. CSE and ECE" }, ...over,
});
const ctx = { companies: [{ id: "c1", name: "Acme Robotics" }], departments: [{ id: "d1", code: "CSE", name: "Computer Science" }, { id: "d2", code: "ECE", name: "Electronics" }, { id: "d3", code: "MECH", name: "Mechanical" }] };

describe("verifyExtraction accepts only what the announcement supports", () => {
  it("accepts a faithful extraction, field by field", () => {
    const v = verifyExtraction(TEXT, ex());
    expect(v.fields.every((f) => f.status === "VERIFIED" || f.key === "maxBacklogs")).toBe(true);
    expect(v.accepted).toMatchObject({ company: "Acme Robotics", ctcLpa: 6.5, openings: 10, minCgpa: 7.5, passingYears: [2026], departments: ["CSE", "ECE"], employmentType: "FULL_TIME" });
    expect(v.issues.filter((i) => i.kind === "MISSING")).toHaveLength(0);
  });
  it("rejects an invented quote (hallucination or prompt injection) and drops the value", () => {
    const v = verifyExtraction(TEXT, ex({ minCgpa: { value: 5, quote: "minimum 5 CGPA" } }));
    expect(v.accepted.minCgpa).toBeUndefined();
    expect(v.fields.find((f) => f.key === "minCgpa")).toMatchObject({ status: "UNSUPPORTED" });
    expect(v.issues.some((i) => i.field === "minCgpa" && i.kind === "UNSUPPORTED")).toBe(true);
  });
  it("rejects a value that is not in its own (real) quote — a real quote cannot launder a wrong number", () => {
    const v = verifyExtraction(TEXT, ex({ minCgpa: { value: 6, quote: "minimum 7.5 CGPA" }, ctcLpa: { value: 65, quote: "CTC: 6.5 LPA" }, openings: { value: 1, quote: "10 openings" } }));
    for (const k of ["minCgpa", "ctcLpa", "openings"] as const) expect(v.accepted[k], k).toBeUndefined();
  });
  it("does not accept a number that is only part of a longer number", () => {
    const v = verifyExtraction("Minimum 75 CGPA is silly. 10 openings.", ex({ company: null, title: null, location: null, employmentType: null, ctcLpa: null, deadline: null, minTenth: null, maxBacklogs: null, passingYears: null, departments: null, minCgpa: { value: 7.5, quote: "Minimum 75 CGPA" }, openings: { value: 1, quote: "10 openings" } }));
    expect(v.accepted.minCgpa).toBeUndefined(); expect(v.accepted.openings).toBeUndefined();
  });
  it("ignores values outside sane ranges even when quoted, and a deadline in the past", () => {
    const text = "Minimum 11 CGPA. CTC 5000 LPA. Last date 2001-01-01 10:00. Years 1990.";
    const v = verifyExtraction(text, ex({ company: null, title: null, location: null, employmentType: null, openings: null, minTenth: null, maxBacklogs: null, departments: null,
      minCgpa: { value: 11, quote: "Minimum 11 CGPA" }, ctcLpa: { value: 5000, quote: "CTC 5000 LPA" }, deadline: { value: "2001-01-01T10:00", quote: "Last date 2001-01-01 10:00" }, passingYears: { value: [1990], quote: "Years 1990" } }));
    expect(Object.keys(v.accepted)).toEqual([]);
    expect(v.fields.map((f) => f.status)).toEqual(["INVALID", "INVALID", "INVALID", "INVALID"].slice(0, v.fields.length));
  });
  it("reports missing required fields and passes the model's own flags through", () => {
    const v = verifyExtraction(TEXT, ex({ openings: null, issues: [{ field: "deadline", kind: "UNCERTAIN", note: "Time zone not stated" }] }));
    expect(v.issues).toEqual(expect.arrayContaining([expect.objectContaining({ field: "openings", kind: "MISSING" }), { field: "deadline", kind: "UNCERTAIN", note: "Time zone not stated" }]));
  });
  it("enum and 'none' values need a matching word in the quote: a wrong type or an invented zero is refused", () => {
    expect(verifyExtraction(TEXT, ex({ employmentType: { value: "CONTRACT", quote: "(full-time)" } })).accepted.employmentType).toBeUndefined();
    expect(verifyExtraction(TEXT, ex({ employmentType: { value: "NOT_A_TYPE", quote: "(full-time)" } })).accepted.employmentType).toBeUndefined();
    expect(verifyExtraction("Interns wanted for 6 months. 4 openings.", ex({ employmentType: { value: "INTERNSHIP", quote: "Interns wanted" } })).accepted.employmentType).toBe("INTERNSHIP");
    expect(verifyExtraction("Up to 2 backlogs allowed.", ex({ maxBacklogs: { value: 0, quote: "Up to 2 backlogs allowed" } })).accepted.maxBacklogs).toBeUndefined();
    expect(verifyExtraction("Zero backlogs at the time of the drive.", ex({ maxBacklogs: { value: 0, quote: "Zero backlogs at the time" } })).accepted.maxBacklogs).toBe(0);
    expect(verifyExtraction("Up to 2 backlogs allowed.", ex({ maxBacklogs: { value: 2, quote: "Up to 2 backlogs allowed" } })).accepted.maxBacklogs).toBe(2);
  });
  it("matching is case- and whitespace-insensitive but not fuzzy", () => {
    expect(verifyExtraction("ACME   ROBOTICS\nis hiring", ex({ company: { value: "Acme Robotics", quote: "acme robotics is hiring" } })).accepted.company).toBe("Acme Robotics");
    expect(verifyExtraction("Acme Robotix is hiring", ex({ company: { value: "Acme Robotics", quote: "Acme Robotics is hiring" } })).accepted.company).toBeUndefined();
  });
});

describe("toFormValues maps to what exists and never invents ids", () => {
  it("maps company and departments by name/code; reports what could not be matched", () => {
    const { values, notes } = toFormValues(verifyExtraction(TEXT, ex({ departments: { value: ["CSE", "ECE"], quote: "B.E. CSE and ECE" } })).accepted, ctx);
    expect(values).toMatchObject({ companyId: "c1", title: "Graduate Engineer Trainee", type: "FULL_TIME", ctc: "6.5", openings: "10", deadline: "2099-03-04T17:00", minCgpa: "7.5", maxBacklogs: "0", years: "2026", departments: "d1,d2" });
    expect(notes).toEqual([]);
    const t2 = toFormValues({ company: "Unknown Corp", departments: ["Textiles"] }, ctx);
    expect(t2.values.companyId).toBeUndefined(); expect(t2.values.departments).toBeUndefined(); expect(t2.notes).toHaveLength(2);
  });
  it("never sets anything that decides eligibility or publishes: there is no status, eligibility or publish field in its output", () => {
    const { values } = toFormValues(verifyExtraction(TEXT, ex()).accepted, ctx);
    for (const k of Object.keys(values)) expect(["companyId", "title", "location", "type", "ctc", "openings", "deadline", "minCgpa", "minTenth", "minTwelfth", "minDiploma", "maxBacklogs", "description", "years", "departments"]).toContain(k);
  });
});

describe("parseModelJson", () => {
  it("accepts plain JSON and fenced JSON; tolerates extra whitespace", () => {
    const body = JSON.stringify({ company: { value: "A", quote: "A is" }, issues: [] });
    expect(parseModelJson(body).company?.value).toBe("A"); expect(parseModelJson("```json\n" + body + "\n```").company?.value).toBe("A");
  });
  it("rejects prose, wrong shapes and oversized fields with safe messages", () => {
    expect(() => parseModelJson("Sure! Here you go")).toThrow("did not return a usable answer");
    expect(() => parseModelJson(JSON.stringify({ openings: { value: "ten", quote: "x" } }))).toThrow("expected format");
    expect(() => parseModelJson(JSON.stringify({ title: { value: "x".repeat(500), quote: "x" } }))).toThrow("expected format");
    expect(() => parseModelJson(JSON.stringify({ issues: Array.from({ length: 50 }, () => ({ field: "a", kind: "MISSING", note: "n" })) }))).toThrow("expected format");
  });
  it("ignores unknown keys the model may add (for example attempts to set eligibility)", () => {
    const r = parseModelJson(JSON.stringify({ title: { value: "T", quote: "T is" }, eligibleStudents: ["everyone"], publish: true, issues: [] }));
    expect(Object.keys(r)).not.toContain("publish"); expect(Object.keys(r)).not.toContain("eligibleStudents");
  });
});

import { describe, expect, it } from "vitest";
import { achievementSchema } from "./achievements";

const ok = { kind: "HACKATHON", title: "Smart India Hackathon finalist", date: "2025-03-01", description: "", link: "" };

describe("achievementSchema", () => {
  it("parses a valid entry; blank optional fields are undefined", () => {
    const r = achievementSchema.parse(ok);
    expect(r).toMatchObject({ kind: "HACKATHON", date: "2025-03-01" });
    expect(r.description).toBeUndefined();
    expect(r.link).toBeUndefined();
  });
  it("accepts an https link and refuses other schemes", () => {
    expect(achievementSchema.safeParse({ ...ok, link: "https://example.org/c/1" }).success).toBe(true);
    for (const bad of ["javascript:alert(1)", "data:text/html,x", "example.org", "ftp://x.example"]) expect(achievementSchema.safeParse({ ...ok, link: bad }).success, bad).toBe(false);
  });
  it("refuses unknown types, short titles, impossible, old and future dates", () => {
    expect(achievementSchema.safeParse({ ...ok, kind: "NOPE" }).success).toBe(false);
    expect(achievementSchema.safeParse({ ...ok, title: "ab" }).success).toBe(false);
    for (const d of ["2025-02-30", "1999-12-31", "2999-01-01", "01/03/2025", ""]) expect(achievementSchema.safeParse({ ...ok, date: d }).success, d).toBe(false);
  });
});

import { changedFields } from "./achievements";
describe("changedFields", () => {
  const a = { kind: "PROJECT", title: "T", achieved_on: "2025-01-01", description: null, link: null };
  it("lists only what differs; null and empty count as the same", () => {
    expect(changedFields(a, { ...a })).toEqual([]);
    expect(changedFields(a, { ...a, description: "" })).toEqual([]);
    expect(changedFields(a, { ...a, title: "T2", link: "https://x.example" })).toEqual(["title", "link"]);
  });
});

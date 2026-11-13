import { describe, expect, it } from "vitest";
import { companyFormSchema } from "./companies";

const ok = { name: "Acme Corp", website: "https://acme.test", industry: "Software", description: "x", contactPerson: "Ravi R", contactEmail: "Ravi@Acme.test", contactPhone: "+91 98765 43210", location: "Pune" };

describe("companyFormSchema", () => {
  it("accepts a full company and normalises the email", () => {
    expect(companyFormSchema.parse(ok).contactEmail).toBe("ravi@acme.test");
  });
  it("only the name is required; blank optionals become undefined", () => {
    const r = companyFormSchema.parse({ name: "Acme", website: "", industry: " ", description: "", contactPerson: "", contactEmail: "", contactPhone: "", location: "" });
    expect(r).toEqual({ name: "Acme" });
  });
  it.each([
    ["no name", { name: "  " }], ["one-letter name", { name: "A" }], ["javascript: website", { website: "javascript:alert(1)" }], ["data: website", { website: "data:text/html,x" }],
    ["bad email", { contactEmail: "nope" }], ["bad phone", { contactPhone: "abc" }], ["long description", { description: "d".repeat(2001) }], ["one-letter location", { location: "X" }],
  ])("rejects %s", (_l, over) => { expect(companyFormSchema.safeParse({ ...ok, ...over }).success).toBe(false); });
});

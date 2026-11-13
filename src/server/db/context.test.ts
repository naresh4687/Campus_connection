import { describe, expect, it } from "vitest";
import { requestContextSchema } from "./context";

const id = "3f2b8c1e-5d4a-4e7b-9c1a-0b2d3e4f5a6b";

describe("requestContextSchema", () => {
  it("accepts a valid college-scoped context", () => {
    expect(requestContextSchema.parse({ userId: id, collegeId: id, role: "STUDENT" }).role).toBe("STUDENT");
  });
  it("allows a null college only for platform admins", () => {
    expect(requestContextSchema.parse({ userId: id, collegeId: null, role: "PLATFORM_SUPER_ADMIN" }).collegeId).toBeNull();
    expect(() => requestContextSchema.parse({ userId: id, collegeId: null, role: "COLLEGE_ADMIN" })).toThrow();
    expect(() => requestContextSchema.parse({ userId: id, collegeId: id, role: "PLATFORM_SUPER_ADMIN" })).toThrow();
  });
  it("rejects unknown roles and malformed ids", () => {
    expect(() => requestContextSchema.parse({ userId: id, collegeId: id, role: "ROOT" })).toThrow();
    expect(() => requestContextSchema.parse({ userId: "x", collegeId: id, role: "STUDENT" })).toThrow();
  });
});

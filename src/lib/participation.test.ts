import { describe, expect, it } from "vitest";
import { countRows, filterRows, parseView, parseWho, participationCsv, type PartRow } from "./participation";

const row = (o: Partial<PartRow>): PartRow => ({ student_id: "s", full_name: "A", register_number: "R1", department_id: "d", department_code: "CSE", contact_email: "a@x.test", phone: null, has_account: true, eligibility: "ELIGIBLE", registration_status: null, evidence_status: null, ...o });
const rows = [row({ student_id: "1", registration_status: "REGISTERED" }), row({ student_id: "2" }), row({ student_id: "3", registration_status: "WITHDRAWN" }), row({ student_id: "4", registration_status: "PENDING_EXTERNAL" }),
  row({ student_id: "5", eligibility: "NEEDS_DATA" }), row({ student_id: "6", eligibility: "NOT_ELIGIBLE" })];

describe("participation views", () => {
  it("not registered means no completed registration (never registered or withdrawn), eligible by default", () => {
    expect(filterRows(rows, "not-registered", "eligible").map((r) => r.student_id)).toEqual(["2", "3"]);
    expect(filterRows(rows, "not-registered", "any").map((r) => r.student_id)).toEqual(["2", "3", "5", "6"]);
    expect(filterRows(rows, "registered", "any").map((r) => r.student_id)).toEqual(["1"]);
    expect(filterRows(rows, "pending", "eligible").map((r) => r.student_id)).toEqual(["4"]);
    expect(filterRows(rows, "all", "any")).toHaveLength(6);
  });
  it("counts who is left to chase: eligible students without a completed registration", () => {
    expect(countRows(rows)).toMatchObject({ students: 6, eligible: 4, registered: 1, pending: 1, notRegistered: 4, needsData: 1, notEligible: 1, toChase: 3 });
  });
  it("unknown query values fall back to safe defaults", () => {
    expect(parseView("../x")).toBe("not-registered"); expect(parseWho("zzz", "registered")).toBe("any"); expect(parseWho(undefined, "not-registered")).toBe("eligible");
  });
  it("the download has one header and one line per student, and neutralises spreadsheet formulas", () => {
    const csv = participationCsv([row({ full_name: "=HYPERLINK(\"http://evil\")", register_number: "R9" })]).trim().split("\r\n");
    expect(csv).toHaveLength(2); expect(csv[0]).toContain("Register number"); expect(csv[1]).toContain("'=HYPERLINK"); expect(csv[1]).toContain("Not registered");
  });
});

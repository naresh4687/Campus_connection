export const ELIGIBILITY_LABEL: Record<string, string> = { ELIGIBLE: "Eligible", NOT_ELIGIBLE: "Not eligible", NEEDS_DATA: "Needs verified data" };
export const CRITERION_LABEL: Record<string, string> = {
  DEPARTMENT: "Department", DEGREE: "Degree", PASSING_YEAR: "Passing year", ACADEMIC_RECORD: "Verified academic record", CGPA: "CGPA", TENTH: "10th percentage", TWELFTH: "12th percentage",
  DIPLOMA: "Diploma percentage", TWELFTH_OR_DIPLOMA: "12th or diploma percentage", ACTIVE_BACKLOGS: "Active backlogs", HISTORICAL_ARREARS: "Historical arrears",
};
export const CHECK_LABEL: Record<string, string> = { PASS: "Met", FAIL: "Not met", MISSING: "Missing" };
export type Check = { criterion: string; required: string | null; actual: string | null; status: "PASS" | "FAIL" | "MISSING"; message: string | null };

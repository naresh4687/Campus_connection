/**
 * Public-site copy. `status` is kept honest: "available" only for what is actually built and tested.
 * Update this list when a phase ships.
 */
export type Feature = { title: string; description: string; status: "available" | "in-development" };

/** Things people may assume exist but do not (yet). Kept next to the feature list so the two stay honest together. */
export const NOT_INCLUDED: string[] = [
  "Email or SMS notifications — notifications appear inside CampusConnect, plus browser push messages where an installation has switched them on. Invitation and reset links are handed over by your administrator.",
  "Automatic virus scanning of uploaded files — files are checked by type and size and served only through short-lived links, but are not scanned for malware.",
  "Instant or automatic deletion — a student’s deletion request is reviewed by the college administrator, and no retention schedule runs by itself.",
  "Placement policy rules such as offer limits or company tiers.",
  "AI help with drafting drives exists but is switched off unless a college's installation enables it, and has not yet been tried with a live AI provider.",
];

export const FEATURES: Feature[] = [
  { title: "College onboarding", description: "Colleges apply online; the platform team reviews, approves or rejects with a reason, and issues a one-time administrator invitation.", status: "available" },
  { title: "Secure sign-in and roles", description: "Five roles — platform administrator, college administrator, placement officer, department coordinator and student — enforced on the server and in the database.", status: "available" },
  { title: "Separate college workspaces", description: "Each college's data is isolated by the database itself, not just by hiding screens.", status: "available" },
  { title: "Audit trail", description: "Sensitive administrative actions are recorded in an append-only log.", status: "available" },
  { title: "Departments, staff and students", description: "Set up departments, invite staff and students, and import student lists from CSV with validation and a preview.", status: "available" },
  { title: "Academic records and verification", description: "Students submit CGPA, board marks and backlogs; coordinators verify or reject with a reason, with full history.", status: "available" },
  { title: "Private documents", description: "Resumes, mark sheets and offer letters kept in private storage and shared only through short-lived links.", status: "available" },
  { title: "Companies and placement drives", description: "Record companies and run drives through draft, publish, close and archive, with eligibility criteria.", status: "available" },
  { title: "Eligibility engine", description: "A deterministic rule engine decides ELIGIBLE, NOT ELIGIBLE or NEEDS DATA from verified academic records and explains why.", status: "available" },
  { title: "Registration, rounds and results", description: "Students register for drives; officers run rounds, enter results and release them when ready.", status: "available" },
  { title: "Offers and verified placements", description: "Selection, offer, acceptance, joining and verified placement are tracked as separate facts, with evidence.", status: "available" },
  { title: "Reports and notifications", description: "Charts and CSV exports from real data, plus an in-app notification inbox.", status: "available" },
];

export const PLACEMENT_FLOW = [
  { title: "Student records", text: "The college adds departments and students. Students complete their academic profile." },
  { title: "Academic verification", text: "Coordinators verify the submitted academic details; rejections carry a reason and students can resubmit." },
  { title: "Placement drive", text: "The placement officer records the company and publishes a drive with its eligibility criteria." },
  { title: "Eligibility and registration", text: "The system checks each student against the criteria using verified data and explains the result. Students register." },
  { title: "Rounds and results", text: "Officers schedule rounds and enter results. Students see results only after they are released." },
  { title: "Offers", text: "Selection is not an offer, and an offer is not an acceptance — each is its own step with its own record." },
  { title: "Verified placement", text: "Joining is confirmed with evidence before it counts as a placement in reports." },
];

export const ONBOARDING_STEPS = [
  { title: "Apply", text: "Submit your college's details using the application form. You receive a private link to check your application's status." },
  { title: "Review", text: "The CampusConnect team reviews the application. The status moves from Submitted to Under review." },
  { title: "Decision", text: "The application is approved, or rejected with a reason you can read on your status page." },
  { title: "Administrator invitation", text: "On approval we create your college workspace and a one-time invitation for your college administrator. The platform team hands the link to you directly." },
  { title: "Set up", text: "Your administrator accepts the invitation, sets a password, and begins setting up departments, staff and students." },
];

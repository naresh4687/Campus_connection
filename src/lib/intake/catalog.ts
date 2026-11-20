import { z } from "zod";

/**
 * AI-assisted drive creation — the field catalogue and the strict result contract.
 * Every extracted field carries a value, a status, a reliability level DERIVED from how it was found (never a model-reported score),
 * the exact supporting text, and whether a person must verify it. Nothing in here can publish a drive or decide eligibility.
 */
export const EXTRACTION_VERSION = "intake-1.0";
export const MAX_SOURCE_CHARS = 20000;
export const MIN_SOURCE_CHARS = 20;

export const STATUSES = ["EXTRACTED", "NEEDS_REVIEW", "MISSING", "AMBIGUOUS", "CONTRADICTORY", "INVALID"] as const;
export type Status = (typeof STATUSES)[number];
export const RELIABILITY = ["HIGH", "MEDIUM", "LOW", "NONE"] as const;
export type Reliability = (typeof RELIABILITY)[number];
/** RULE = deterministic pattern; MODEL = language model (quote verified); BOTH = they agree; HUMAN = typed or confirmed by staff. */
export const ORIGINS = ["RULE", "MODEL", "BOTH", "HUMAN", "NONE"] as const;
export type Origin = (typeof ORIGINS)[number];

export const SECTIONS = [
  { id: "company", title: "Company information" },
  { id: "job", title: "Job details" },
  { id: "salary", title: "Salary and benefits" },
  { id: "academic", title: "Academic eligibility" },
  { id: "process", title: "Recruitment process" },
  { id: "dates", title: "Dates and deadlines" },
  { id: "documents", title: "Required documents" },
  { id: "conditions", title: "Important employment conditions" },
  { id: "contact", title: "Contact information" },
  { id: "extra", title: "Additional information" },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];

export type Kind = "text" | "longtext" | "number" | "int" | "datetime" | "enum" | "list" | "years" | "departments" | "degrees";
export type FieldDef = {
  key: string; label: string; section: SectionId; kind: Kind;
  /** Needed before a drive can be published (matches the database rule for PUBLISHED drives, plus the identity of the drive). */
  mandatory?: boolean;
  /** Decides who may apply. A value in one of these is NEVER used until it is clean (EXTRACTED) or a person has confirmed it. */
  eligibility?: boolean;
  options?: readonly { value: string; label: string }[];
  max?: number; hint?: string;
};

const WORK_MODES = [{ value: "ONSITE", label: "Onsite" }, { value: "HYBRID", label: "Hybrid" }, { value: "REMOTE", label: "Remote" }] as const;
const CTC_KINDS = [{ value: "EXACT", label: "Fixed amount" }, { value: "UP_TO", label: "Up to (upper limit)" }, { value: "AT_LEAST", label: "At least (lower limit)" }, { value: "RANGE", label: "Range" }] as const;
const EXPERIENCE = [{ value: "FRESHER", label: "Freshers" }, { value: "EXPERIENCED", label: "Experienced" }, { value: "BOTH", label: "Both" }] as const;
export const TYPE_OPTIONS = [
  { value: "FULL_TIME", label: "Full-time" }, { value: "INTERNSHIP", label: "Internship" }, { value: "INTERNSHIP_PPO", label: "Internship with PPO" }, { value: "CONTRACT", label: "Contract" },
] as const;

export const FIELDS: readonly FieldDef[] = [
  { key: "company", label: "Company name", section: "company", kind: "text", mandatory: true, max: 150 },
  { key: "website", label: "Website", section: "company", kind: "text", max: 300 },
  { key: "industry", label: "Industry", section: "company", kind: "text", max: 150 },
  { key: "companyDescription", label: "About the company", section: "company", kind: "longtext", max: 2000 },

  { key: "title", label: "Job title", section: "job", kind: "text", mandatory: true, max: 150 },
  { key: "designation", label: "Designation", section: "job", kind: "text", max: 150 },
  { key: "employmentType", label: "Employment type", section: "job", kind: "enum", mandatory: true, options: TYPE_OPTIONS },
  { key: "experience", label: "Fresher or experienced", section: "job", kind: "enum", options: EXPERIENCE },
  { key: "experienceNote", label: "Experience requirement", section: "job", kind: "text", max: 200 },
  { key: "workMode", label: "Remote, hybrid or onsite", section: "job", kind: "enum", options: WORK_MODES },
  { key: "location", label: "Work location", section: "job", kind: "text", max: 150 },
  { key: "openings", label: "Openings", section: "job", kind: "int", mandatory: true },
  { key: "description", label: "Job description", section: "job", kind: "longtext", max: 2000 },
  { key: "responsibilities", label: "Responsibilities", section: "job", kind: "longtext", max: 1500 },
  { key: "skills", label: "Required skills (not eligibility)", section: "job", kind: "list", hint: "One per line. Skills are information for students; they never decide eligibility." },
  { key: "qualification", label: "Qualification text", section: "job", kind: "text", max: 300 },

  { key: "ctcLpa", label: "CTC / package (LPA)", section: "salary", kind: "number", hint: "A number of lakhs per annum. Monthly amounts never go here." },
  { key: "ctcKind", label: "How the CTC is stated", section: "salary", kind: "enum", options: CTC_KINDS },
  { key: "ctcMaxLpa", label: "Upper end of range (LPA)", section: "salary", kind: "number" },
  { key: "fixedLpa", label: "Fixed compensation (LPA)", section: "salary", kind: "number" },
  { key: "variableLpa", label: "Variable compensation (LPA)", section: "salary", kind: "number" },
  { key: "monthlySalary", label: "Monthly salary (₹)", section: "salary", kind: "number" },
  { key: "stipend", label: "Internship stipend (₹ per month)", section: "salary", kind: "number" },
  { key: "trainingSalary", label: "During training", section: "salary", kind: "text", max: 150 },
  { key: "postTrainingSalary", label: "After training", section: "salary", kind: "text", max: 150 },
  { key: "benefits", label: "Benefits", section: "salary", kind: "longtext", max: 800 },
  { key: "ctcNote", label: "Salary summary shown to students (max 200 characters)", section: "salary", kind: "text", max: 200 },

  { key: "departments", label: "Eligible departments", section: "academic", kind: "departments", mandatory: true, eligibility: true },
  { key: "preferredDepartments", label: "Preferred (not mandatory) departments", section: "academic", kind: "list", hint: "Information only; these do not restrict or widen eligibility." },
  { key: "degrees", label: "Degrees", section: "academic", kind: "degrees", eligibility: true },
  { key: "specializations", label: "Specializations", section: "academic", kind: "list" },
  { key: "passingYears", label: "Eligible passing years (batches)", section: "academic", kind: "years", mandatory: true, eligibility: true },
  { key: "minCgpa", label: "Minimum CGPA", section: "academic", kind: "number", eligibility: true, hint: "Inclusive: students at exactly this value are eligible." },
  { key: "minTenth", label: "Minimum 10th %", section: "academic", kind: "number", eligibility: true },
  { key: "minTwelfth", label: "Minimum 12th %", section: "academic", kind: "number", eligibility: true },
  { key: "minDiploma", label: "Minimum diploma %", section: "academic", kind: "number", eligibility: true },
  { key: "maxBacklogs", label: "Maximum ACTIVE backlogs", section: "academic", kind: "int", eligibility: true, hint: "0 means none allowed. Current, standing arrears only." },
  { key: "maxArrears", label: "Maximum HISTORICAL arrears", section: "academic", kind: "int", eligibility: true, hint: "Arrears ever failed, including cleared ones." },
  { key: "otherAcademic", label: "Other academic conditions", section: "academic", kind: "longtext", max: 800, hint: "Not checked by the platform." },

  { key: "rounds", label: "Recruitment rounds (in order)", section: "process", kind: "list" },
  { key: "venue", label: "Venue", section: "process", kind: "text", max: 300 },
  { key: "meetingLink", label: "Online meeting details", section: "process", kind: "text", max: 300 },
  { key: "registrationLink", label: "External registration link", section: "process", kind: "text", max: 300 },
  { key: "applicationInstructions", label: "Application instructions", section: "process", kind: "longtext", max: 1500 },

  { key: "applicationOpens", label: "Applications open", section: "dates", kind: "datetime" },
  { key: "deadline", label: "Application deadline (IST)", section: "dates", kind: "datetime", mandatory: true },
  { key: "preplacementTalk", label: "Pre-placement talk", section: "dates", kind: "datetime" },
  { key: "recruitmentDate", label: "Recruitment / drive date", section: "dates", kind: "datetime" },

  { key: "documents", label: "Documents students must bring or upload", section: "documents", kind: "list" },

  { key: "bond", label: "Service agreement / bond", section: "conditions", kind: "longtext", max: 1000 },
  { key: "trainingPeriod", label: "Training period", section: "conditions", kind: "text", max: 300 },
  { key: "relocation", label: "Relocation", section: "conditions", kind: "text", max: 300 },
  { key: "shifts", label: "Work shifts", section: "conditions", kind: "text", max: 300 },
  { key: "joiningTimeline", label: "Joining timeline", section: "conditions", kind: "text", max: 300 },
  { key: "otherConditions", label: "Other company conditions", section: "conditions", kind: "longtext", max: 1000 },

  { key: "contactName", label: "Recruitment contact", section: "contact", kind: "text", max: 150 },
  { key: "contactEmail", label: "Contact email", section: "contact", kind: "text", max: 200 },
  { key: "contactPhone", label: "Contact phone", section: "contact", kind: "text", max: 40 },

  { key: "additionalInfo", label: "Additional information (anything that fits nowhere else)", section: "extra", kind: "longtext", max: 3000 },
];
export const FIELD_BY_KEY: Record<string, FieldDef> = Object.fromEntries(FIELDS.map((f) => [f.key, f]));
export const FIELD_KEYS = FIELDS.map((f) => f.key);
export const MANDATORY_KEYS = FIELDS.filter((f) => f.mandatory).map((f) => f.key);
export const ELIGIBILITY_KEYS = FIELDS.filter((f) => f.eligibility).map((f) => f.key);

// ── the stored contract ──
const valueSchema = z.union([z.string().max(5000), z.number().finite(), z.array(z.union([z.string().max(300), z.number().finite()])).max(60), z.null()]);
const alternative = z.object({ value: valueSchema, evidence: z.string().max(600), origin: z.enum(ORIGINS) });
export const fieldResultSchema = z.object({
  value: valueSchema,
  status: z.enum(STATUSES),
  reliability: z.enum(RELIABILITY),
  origin: z.enum(ORIGINS),
  evidence: z.string().max(600),
  /** True when a person must look at this before relying on it. */
  needsVerification: z.boolean(),
  note: z.string().max(400).optional(),
  alternatives: z.array(alternative).max(6).optional(),
  /** Set when staff typed or confirmed the value. A re-extraction never replaces a human value without being asked. */
  human: z.boolean().optional(),
});
export type FieldResult = z.infer<typeof fieldResultSchema>;
export type FieldValue = z.infer<typeof valueSchema>;
export type Fields = Record<string, FieldResult>;
export const fieldsSchema = z.record(z.string(), fieldResultSchema);

export const warningsSchema = z.array(z.object({ kind: z.enum(["INJECTION", "NOTE", "UNMAPPED_DEPARTMENT", "TRUNCATED"]), message: z.string().max(400) })).max(30);
export type Warning = z.infer<typeof warningsSchema>[number];

export const extractionSchema = z.object({ fields: fieldsSchema, warnings: warningsSchema, methods: z.array(z.string().max(40)).max(5) });
export type Extraction = z.infer<typeof extractionSchema>;

export const emptyField = (note = "Not provided in the announcement."): FieldResult => ({ value: null, status: "MISSING", reliability: "NONE", origin: "NONE", evidence: "", needsVerification: false, note });
export const isEmptyValue = (v: FieldValue | undefined): boolean => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

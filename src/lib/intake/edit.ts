import { driveFormSchema, istToIso } from "../drives";
import { ELIGIBILITY_KEYS, FIELDS, FIELD_BY_KEY, MANDATORY_KEYS, STATUSES, isEmptyValue, type FieldDef, type FieldResult, type FieldValue, type Fields, type Status } from "./catalog";
import { coerce, composeSalaryNote } from "./merge";
import type { Dept } from "./departments";

type Ctx = { departments: Dept[] };

/** A value may be used (shown to students, checked against criteria) only when it is clean or a person has confirmed or typed it. */
export const settled = (f: FieldResult | undefined): boolean => !!f && !isEmptyValue(f.value) && (f.status === "EXTRACTED" || f.human === true);
const sig = (v: FieldValue) => JSON.stringify(Array.isArray(v) ? [...v].map(String).sort() : v);

/** The text shown in a field's edit control. */
export function toInput(def: FieldDef, v: FieldValue): string {
  if (isEmptyValue(v)) return "";
  if (Array.isArray(v)) return def.kind === "list" ? v.join("\n") : v.join(",");
  return String(v);
}

export type Posted = { raw: string | string[] | undefined; confirm: boolean };
export type EditResult = { fields: Fields; errors: Record<string, string> };

const human = (value: FieldValue, note?: string): FieldResult => ({ value, status: "EXTRACTED", reliability: "HIGH", origin: "HUMAN", evidence: "Entered or confirmed by staff.", needsVerification: false, human: true, note });

/**
 * Applies the officer's form to the working copy. Only fields whose value actually changed (or that were explicitly confirmed) become "human";
 * everything else keeps its machine status and evidence — saving never quietly confirms an unchecked value.
 */
export function applyEdits(current: Fields, posted: Record<string, Posted>, ctx: Ctx): EditResult {
  const next: Fields = { ...current }; const errors: Record<string, string> = {};
  for (const def of FIELDS) {
    if (def.key === "ctcNote" && !(def.key in posted)) continue;
    const p = posted[def.key]; if (!p) continue;
    const cur = current[def.key];
    const rawArr = Array.isArray(p.raw) ? p.raw : undefined;
    const rawStr = typeof p.raw === "string" ? p.raw.trim() : undefined;
    const blank = rawArr ? rawArr.length === 0 : !rawStr;
    if (blank) {
      if (cur && !isEmptyValue(cur.value)) next[def.key] = { value: null, status: "MISSING", reliability: "NONE", origin: "HUMAN", evidence: "", needsVerification: false, human: true, note: "Removed by staff." };
      continue;
    }
    const c = coerce(def, rawArr ?? rawStr, ctx);
    if (!c.ok) { errors[def.key] = `${def.label} ${c.reason}.`; continue; }
    if (cur && !isEmptyValue(cur.value) && sig(cur.value) === sig(c.value)) {
      if (p.confirm && !cur.human && cur.status !== "EXTRACTED") next[def.key] = { ...cur, status: "EXTRACTED", reliability: cur.reliability === "NONE" ? "MEDIUM" : cur.reliability, needsVerification: false, human: true, note: undefined };
      else if (p.confirm && !cur.human) next[def.key] = { ...cur, human: true };
      continue;
    }
    next[def.key] = human(c.value, c.note);
  }
  const lo = next.ctcLpa?.value, hi = next.ctcMaxLpa?.value;
  if (typeof lo === "number" && typeof hi === "number" && hi < lo) errors.ctcMaxLpa = "The upper end of the range is below the lower end.";
  if (!next.ctcNote?.human) {
    const n = composeSalaryNote(next);
    next.ctcNote = n ? { value: n.slice(0, 200), status: n.length > 200 ? "NEEDS_REVIEW" : "EXTRACTED", reliability: "HIGH", origin: "RULE", evidence: "Composed from the salary fields above.", needsVerification: n.length > 200, note: n.length > 200 ? "Shortened to 200 characters; edit it." : undefined } : { ...next.ctcNote, value: null, status: "MISSING", reliability: "NONE", origin: "NONE", evidence: "", needsVerification: false } as FieldResult;
  }
  return { fields: next, errors };
}

// ───────────── mapping to the ordinary drive ─────────────
const get = (f: Fields, k: string) => (settled(f[k]) ? f[k].value : null);
const str = (f: Fields, k: string) => { const v = get(f, k); return typeof v === "string" ? v : Array.isArray(v) ? v.join(", ") : v === null ? "" : String(v); };
const section = (title: string, lines: (string | null | false)[]) => { const l = lines.filter(Boolean) as string[]; return l.length ? [`${title}${l.length ? "" : ""}`, ...l].join("\n") : ""; };
const datetimeText = (v: string) => { const [d, t] = v.split("T"); return t ? `${d} ${t} IST` : d; };

export type DriveMapping = { values: Record<string, string>; problems: string[]; held: string[]; canCreate: boolean };
/** Maps the SETTLED fields onto the existing drive form. Over-long text is reported, never silently cut; unsettled eligibility values are held back and listed. */
export function toDriveValues(f: Fields, ctx: Ctx): DriveMapping {
  const v: Record<string, string> = {}; const problems: string[] = [];
  const put = (key: string, text: string, max: number, label: string) => { if (!text) return; if (text.length > max) problems.push(`${label} is ${text.length} characters; the drive allows ${max}. Shorten the fields it is built from.`); else v[key] = text; };
  v.companyName = str(f, "company"); v.title = str(f, "title"); v.type = str(f, "employmentType");
  if (get(f, "location")) v.location = str(f, "location");
  const kind = settled(f.ctcKind) ? String(f.ctcKind.value) : f.ctcLpa?.human ? "EXACT" : null;
  if (get(f, "ctcLpa") !== null && kind === "EXACT") v.ctc = String(get(f, "ctcLpa"));
  put("ctcNote", str(f, "ctcNote"), 200, "The salary summary");
  const desc = [str(f, "description"), str(f, "responsibilities") && `Responsibilities: ${str(f, "responsibilities")}`, str(f, "skills") && `Skills: ${str(f, "skills")}`, str(f, "experienceNote") && `Experience: ${str(f, "experienceNote")}`, str(f, "workMode") && `Work mode: ${str(f, "workMode").toLowerCase()}`, str(f, "companyDescription") && `About the company: ${str(f, "companyDescription")}`].filter(Boolean).join("\n\n");
  put("description", desc, 4000, "The job description");
  put("qualification", str(f, "qualification"), 300, "The qualification");
  put("bond", [str(f, "bond"), str(f, "trainingPeriod") && `Training: ${str(f, "trainingPeriod")}`].filter(Boolean).join("\n"), 1000, "The bond and training text");
  if (get(f, "openings") !== null) v.openings = String(get(f, "openings"));
  const dl = str(f, "deadline"); if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(dl)) v.deadline = dl;
  const interview = section("", [str(f, "rounds") && `Rounds: ${((get(f, "rounds") as string[]) ?? []).join(" → ")}`, str(f, "venue") && `Venue: ${str(f, "venue")}`, str(f, "meetingLink") && `Online: ${str(f, "meetingLink")}`, str(f, "preplacementTalk") && `Pre-placement talk: ${datetimeText(str(f, "preplacementTalk"))}`, str(f, "recruitmentDate") && `Recruitment date: ${datetimeText(str(f, "recruitmentDate"))}`].map((x) => x || null)).replace(/^\n/, "");
  put("interview", interview, 2000, "The interview details");
  const instr = [str(f, "registrationLink") && `Register: ${str(f, "registrationLink")}`, str(f, "applicationInstructions"), str(f, "applicationOpens") && `Applications open: ${datetimeText(str(f, "applicationOpens"))}`, str(f, "documents") && `Documents: ${str(f, "documents")}`,
    str(f, "relocation") && `Relocation: ${str(f, "relocation")}`, str(f, "shifts") && `Shifts: ${str(f, "shifts")}`, str(f, "joiningTimeline") && `Joining: ${str(f, "joiningTimeline")}`, str(f, "otherConditions") && `Other conditions: ${str(f, "otherConditions")}`,
    str(f, "benefits") && `Benefits: ${str(f, "benefits")}`, str(f, "specializations") && `Specializations: ${str(f, "specializations")}`, str(f, "preferredDepartments") && `Preferred departments (not a restriction): ${str(f, "preferredDepartments")}`,
    str(f, "otherAcademic") && `Other academic conditions (not checked by the platform): ${str(f, "otherAcademic")}`, [str(f, "contactName"), str(f, "contactEmail"), str(f, "contactPhone")].filter(Boolean).join(", ") && `Contact: ${[str(f, "contactName"), str(f, "contactEmail"), str(f, "contactPhone")].filter(Boolean).join(", ")}`,
    str(f, "website") && `Website: ${str(f, "website")}`, str(f, "additionalInfo") && `Additional information: ${str(f, "additionalInfo")}`].filter(Boolean).join("\n");
  put("instructions", instr, 3000, "The student instructions");
  const held: string[] = [];
  for (const k of ELIGIBILITY_KEYS) if (!isEmptyValue(f[k]?.value) && !settled(f[k])) held.push(FIELD_BY_KEY[k].label);
  for (const k of ["minCgpa", "minTenth", "minTwelfth", "minDiploma", "maxBacklogs", "maxArrears"]) if (get(f, k) !== null) v[k] = String(get(f, k));
  const depCodes = (get(f, "departments") as string[] | null) ?? [];
  v.departments = depCodes.map((c) => ctx.departments.find((d) => d.code === c)?.id).filter(Boolean).join(",");
  v.years = ((get(f, "passingYears") as number[] | null) ?? []).join(",");
  v.degrees = ((get(f, "degrees") as string[] | null) ?? []).join(",");
  return { values: v, problems, held, canCreate: !!(v.companyName && v.title && v.type) };
}

// ───────────── readiness for publishing ─────────────
export type Problem = { key: string; message: string };
export type Readiness = { errors: Problem[]; warnings: string[]; ready: boolean; counts: { extracted: number; review: number; missingMandatory: number; contradictions: number } };

export function summarize(f: Fields) {
  const all = FIELDS.map((d) => f[d.key]).filter(Boolean);
  return {
    extracted: all.filter((x) => x.status === "EXTRACTED" && !isEmptyValue(x.value)).length,
    review: all.filter((x) => (x.status === "NEEDS_REVIEW" || x.status === "AMBIGUOUS" || x.status === "INVALID") && !x.human).length,
    missingMandatory: MANDATORY_KEYS.filter((k) => !settled(f[k])).length,
    contradictions: all.filter((x) => x.status === "CONTRADICTORY" && !x.human).length,
  };
}

/** Everything that must be true before the Publish button is offered. The database repeats the hard rules; this explains them in the officer's terms. */
export function readiness(f: Fields, ctx: Ctx, now = new Date()): Readiness {
  const errors: Problem[] = []; const warnings: string[] = [];
  const add = (key: string, message: string) => errors.push({ key, message });
  for (const k of MANDATORY_KEYS) if (!settled(f[k])) add(k, `${FIELD_BY_KEY[k].label} is ${f[k] && !isEmptyValue(f[k].value) ? "not confirmed yet" : "missing"}.`);
  for (const def of FIELDS) {
    const x = f[def.key]; if (!x || x.human) continue;
    if (x.status === "CONTRADICTORY") add(def.key, `${def.label}: the announcement gives conflicting values. Choose the right one.`);
    else if (def.eligibility && !isEmptyValue(x.value) && x.status !== "EXTRACTED") add(def.key, `${def.label}: confirm or correct the value found (it decides who can apply).`);
    else if (def.eligibility && (x.status === "AMBIGUOUS" || x.status === "INVALID")) add(def.key, `${def.label}: ${x.status === "AMBIGUOUS" ? "the announcement is unclear" : "the value found is not valid"}. Enter it or clear it.`);
  }
  const dl = settled(f.deadline) ? String(f.deadline.value) : "";
  if (dl && !/T/.test(dl)) add("deadline", "The application deadline needs a time as well as a date.");
  else if (dl && (istToIso(dl) ? new Date(istToIso(dl)!) <= now : false)) add("deadline", "The application deadline must be in the future.");
  const m = toDriveValues(f, ctx);
  for (const p of m.problems) add("drive", p);
  if (m.canCreate) {
    const r = driveFormSchema.safeParse({ ...m.values, departments: m.values.departments ? m.values.departments.split(",") : [], years: m.values.years ? m.values.years.split(",") : [], degrees: m.values.degrees ? m.values.degrees.split(",") : [] });
    if (!r.success) for (const i of r.error.issues) add(String(i.path[0] ?? "drive"), i.message);
  }
  for (const d of (get(f, "departments") as string[] | null) ?? []) if (!ctx.departments.some((x) => x.code === d)) add("departments", `Department ${d} is not an active department of your college.`);
  if (get(f, "ctcLpa") !== null && settled(f.ctcKind) && f.ctcKind.value !== "EXACT") warnings.push("The CTC is an upper/lower limit or a range, so the numeric CTC on the drive is left empty and the wording is kept in the salary summary.");
  if (!isEmptyValue(f.preferredDepartments?.value)) warnings.push("Preferred departments are shown to students as information only. They do not change who is eligible.");
  const unresolved = FIELDS.filter((d) => !d.eligibility && f[d.key] && (f[d.key].status === "NEEDS_REVIEW" || f[d.key].status === "AMBIGUOUS") && !f[d.key].human && !isEmptyValue(f[d.key].value)).length;
  if (unresolved) warnings.push(`${unresolved} non-eligibility field(s) are still marked “needs review”. They are included in the draft as written; check them.`);
  return { errors, warnings, ready: errors.length === 0, counts: summarize(f) };
}

// ───────────── re-extraction: differences, never overwrites ─────────────
export type DiffRow = { key: string; label: string; kind: "NEW" | "CHANGED" | "KEEP_YOURS"; current: FieldResult | null; proposed: FieldResult };
/** What a fresh extraction would change. Staff-entered values are listed as "keep yours" with the new value beside them; nothing is applied here. */
export function diffExtractions(current: Fields, fresh: Fields): DiffRow[] {
  const rows: DiffRow[] = [];
  for (const def of FIELDS) {
    const c = current[def.key]; const n = fresh[def.key];
    if (!n || (isEmptyValue(n.value) && n.status === "MISSING") || (isEmptyValue(n.value) && n.status !== "CONTRADICTORY" && n.status !== "AMBIGUOUS")) continue;
    if (def.key === "ctcNote" && c?.human) continue;
    const same = c && sig(c.value) === sig(n.value) && c.status === n.status;
    if (same) continue;
    if (c && isEmptyValue(c.value) && !c.human) rows.push({ key: def.key, label: def.label, kind: "NEW", current: c, proposed: n });
    else if (c?.human) { if (sig(c.value) !== sig(n.value)) rows.push({ key: def.key, label: def.label, kind: "KEEP_YOURS", current: c, proposed: n }); }
    else if (c && (sig(c.value) !== sig(n.value) || c.status !== n.status)) rows.push({ key: def.key, label: def.label, kind: "CHANGED", current: c, proposed: n });
    else if (!c) rows.push({ key: def.key, label: def.label, kind: "NEW", current: null, proposed: n });
  }
  return rows;
}
/** Applies ONLY the chosen keys from the fresh extraction. */
export function applyChoices(current: Fields, fresh: Fields, keys: string[]): Fields {
  const next: Fields = { ...current };
  for (const k of keys) if (fresh[k] && FIELD_BY_KEY[k]) next[k] = fresh[k];
  return next;
}

export { STATUSES };
export type { Status };

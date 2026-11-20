import { z } from "zod";
import { istToIso } from "../drives";
import { DEGREES } from "../students";
import { ELIGIBILITY_KEYS, EXTRACTION_VERSION, FIELDS, FIELD_BY_KEY, MAX_SOURCE_CHARS, emptyField, type Extraction, type FieldDef, type FieldResult, type FieldValue, type Fields, type Origin, type Reliability, type Status, type Warning } from "./catalog";
import { mapDepartments, type Dept } from "./departments";
import { INJECTION_RE, extractRules, findDates, normalizeSource, type Candidate } from "./rules";

export type BuildCtx = { now: Date; departments: Dept[] };

// ───────────── value normalisation (shared by the model path, the rule path and human edits) ─────────────
const collapse = (s: string) => s.replace(/\s+/g, " ").trim();
const alnum = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const RANGE: Record<string, [number, number]> = { ctcLpa: [0, 1000], ctcMaxLpa: [0, 1000], fixedLpa: [0, 1000], variableLpa: [0, 1000], monthlySalary: [0, 10_000_000], stipend: [0, 10_000_000], minCgpa: [0, 10], minTenth: [0, 100], minTwelfth: [0, 100], minDiploma: [0, 100], openings: [1, 10000], maxBacklogs: [0, 50], maxArrears: [0, 200] };

export type Coerced = { ok: true; value: FieldValue; note?: string } | { ok: false; reason: string };
export function coerce(def: FieldDef, raw: unknown, ctx: { departments: Dept[] }): Coerced {
  const key = def.key;
  switch (def.kind) {
    case "text": case "longtext": {
      if (typeof raw !== "string") return { ok: false, reason: "must be text" };
      const s = def.kind === "text" ? collapse(raw) : raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      if (!s) return { ok: false, reason: "is empty" };
      return s.length > (def.max ?? 1000) ? { ok: true, value: s.slice(0, def.max ?? 1000), note: `Shortened to ${def.max} characters; check it.` } : { ok: true, value: s };
    }
    case "number": case "int": {
      const n = typeof raw === "number" ? raw : typeof raw === "string" && /^\s*\d[\d,]*(?:\.\d+)?\s*$/.test(raw) ? Number(raw.replace(/,/g, "")) : NaN;
      const [lo, hi] = RANGE[key] ?? [0, 1e9];
      if (!Number.isFinite(n)) return { ok: false, reason: "must be a number" };
      if (def.kind === "int" && !Number.isInteger(n)) return { ok: false, reason: "must be a whole number" };
      if (n < lo || n > hi) return { ok: false, reason: `must be between ${lo} and ${hi}` };
      return { ok: true, value: Math.round(n * 100) / 100 };
    }
    case "datetime": {
      if (typeof raw !== "string") return { ok: false, reason: "must be a date" };
      const v = raw.trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return istToIso(`${v}T00:00`) ? { ok: true, value: v } : { ok: false, reason: "is not a real date" };
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v)) return istToIso(v) ? { ok: true, value: v } : { ok: false, reason: "is not a real date and time" };
      return { ok: false, reason: "is not a date" };
    }
    case "enum": return typeof raw === "string" && def.options!.some((o) => o.value === raw) ? { ok: true, value: raw } : { ok: false, reason: "is not one of the allowed choices" };
    case "list": {
      const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/\n|;/) : null;
      if (!arr) return { ok: false, reason: "must be a list" };
      const out = [...new Set(arr.map((x) => collapse(String(x))).filter(Boolean))].slice(0, 40).map((x) => x.slice(0, 200));
      return out.length ? { ok: true, value: out } : { ok: false, reason: "is empty" };
    }
    case "years": {
      const arr = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[,\s]+/).filter(Boolean) : null;
      if (!arr) return { ok: false, reason: "must be a list of years" };
      const ys = arr.map((y) => Number(y));
      if (!ys.length || ys.some((y) => !Number.isInteger(y) || y < 2000 || y > 2100)) return { ok: false, reason: "years must be between 2000 and 2100" };
      return { ok: true, value: [...new Set(ys)].sort().slice(0, 10) };
    }
    case "degrees": {
      const arr = Array.isArray(raw) ? raw.map(String) : null;
      if (!arr || !arr.length || arr.some((d) => !(DEGREES as readonly string[]).includes(d))) return { ok: false, reason: "contains an unknown degree" };
      return { ok: true, value: [...new Set(arr)] };
    }
    case "departments": {
      const arr = Array.isArray(raw) ? raw.map(String) : typeof raw === "string" ? raw.split(/[,\n]/).map((x) => x.trim()).filter(Boolean) : null;
      if (!arr || !arr.length) return { ok: false, reason: "must be a list of departments" };
      if (arr.includes("*ALL*")) return { ok: true, value: ctx.departments.map((d) => d.code), note: "The announcement says all branches, so every department of your college was selected. Confirm." };
      const { codes, unmatched } = mapDepartments(arr, ctx.departments);
      if (!codes.length) return { ok: false, reason: `matches no department of your college (${unmatched.join(", ")})` };
      return { ok: true, value: codes, note: unmatched.length ? `Not matched to a department of your college: ${unmatched.join(", ")}.` : undefined };
    }
  }
}

// ───────────── model output → candidates (every value must be backed by a quote that is really in the announcement) ─────────────
const modelField = z.object({ value: z.unknown(), quote: z.string().max(700) }).nullable();
export const modelOutputSchema = z.object({ fields: z.record(z.string(), modelField.optional()).default({}) }).passthrough();
export const MODEL_KEYS = FIELDS.map((f) => f.key).filter((k) => !["ctcNote", "preferredDepartments"].includes(k));

const sameNumber = (n: number, text: string) => { const forms = [String(n), n.toFixed(1), n.toFixed(2)]; return forms.some((f) => new RegExp(`(^|[^0-9.])${f.replace(".", "\\.")}(?![0-9]|\\.[0-9])`).test(text)); };
const CTC_KIND_WORDS: Record<string, RegExp> = { UP_TO: /up ?to|upto|maximum|\bmax\b|not exceeding|as high as/i, AT_LEAST: /minimum|at least|starting|starts|from/i, RANGE: /\d\s*(?:-|–|—|to|and)\s*\d/i, EXACT: /\d/ };
const MODE_WORDS: Record<string, RegExp> = { ONSITE: /on[- ]?site|work from office|office/i, HYBRID: /hybrid/i, REMOTE: /remote|work from home|wfh/i };
const EXP_WORDS: Record<string, RegExp> = { FRESHER: /fresher|0\s*(?:-|to)\s*1|no experience/i, EXPERIENCED: /experience|\d\s*\+?\s*years/i, BOTH: /fresher[\s\S]*experienc|experienc[\s\S]*fresher/i };
const TYPE_WORDS: Record<string, RegExp> = { FULL_TIME: /full[\s-]?time|permanent|regular employee/i, INTERNSHIP: /intern/i, INTERNSHIP_PPO: /\bppo\b|pre[\s-]?placement|conversion|intern/i, CONTRACT: /contract/i };

export function modelToCandidates(src: string, raw: unknown, ctx: BuildCtx): { candidates: Candidate[]; dropped: string[] } {
  const parsed = modelOutputSchema.safeParse(raw);
  if (!parsed.success) return { candidates: [], dropped: ["The assistant's answer was not in the expected format and was ignored."] };
  const a = alnum(src); const out: Candidate[] = []; const dropped: string[] = [];
  for (const [key, f] of Object.entries(parsed.data.fields)) {
    const def = FIELD_BY_KEY[key];
    if (!def || !MODEL_KEYS.includes(key) || !f || f.value === null || f.value === undefined) continue;     // unknown keys (including hostile extras) are ignored
    const quote = collapse(f.quote); const q = alnum(quote);
    if (q.length < 2 || !a.includes(q)) { dropped.push(`${def.label}: the quoted text is not in the announcement`); continue; }
    const c = coerce(def, f.value, ctx);
    if (!c.ok) { dropped.push(`${def.label}: ${c.reason}`); continue; }
    let supported = false; let weak = false; let value = c.value;
    switch (def.kind) {
      case "number": case "int": supported = typeof value === "number" && sameNumber(value, quote); break;
      case "enum":
        supported = key === "employmentType" ? TYPE_WORDS[String(value)]?.test(quote) ?? false : key === "workMode" ? MODE_WORDS[String(value)]?.test(quote) ?? false : key === "experience" ? EXP_WORDS[String(value)]?.test(quote) ?? false : key === "ctcKind" ? CTC_KIND_WORDS[String(value)]?.test(quote) ?? false : false; break;
      case "datetime": { const d = findDates(quote, ctx.now).map((h) => h.date); supported = d.includes(String(value).slice(0, 10)); break; }
      case "years": supported = (value as number[]).every((y) => quote.includes(String(y))); break;
      case "degrees": supported = (value as string[]).every((d) => new RegExp(d.replace(/\./g, "\\.?").replace(/^B\\\.\?E\\\.\?$/, "B\\.?E")).test(quote) || alnum(quote).includes(alnum(d))); break;
      case "departments": { const names = Array.isArray(f.value) ? (f.value as unknown[]).map(String) : []; supported = names.length > 0 && names.every((n) => n === "*ALL*" ? /\ball\b/i.test(quote) : q.includes(alnum(n))); if (supported && names.includes("*ALL*")) value = c.value; break; }
      case "list": { const items = value as string[]; const kept = items.filter((it) => alnum(it).split(" ").filter((w) => w.length >= 4).some((w) => q.includes(w)) || q.includes(alnum(it))); if (!kept.length) { dropped.push(`${def.label}: not supported by the quote`); continue; } value = kept; supported = kept.length === items.length; weak = !supported; break; }
      case "text": supported = q.includes(alnum(String(value))); weak = !supported && String(value).length > 0; break;
      case "longtext": weak = true; supported = false; break;
    }
    if (!supported && !weak) { dropped.push(`${def.label}: the value is not found in the quoted text`); continue; }
    out.push({ key, value, evidence: quote.slice(0, 600), origin: "MODEL", strength: supported ? "heuristic" : "weak", note: c.note });
  }
  return { candidates: out, dropped };
}

// ───────────── merging ─────────────
const LIST_UNION = new Set(["rounds", "documents", "skills", "specializations", "preferredDepartments"]);
const ELIGIBILITY_LISTS = new Set(["departments", "passingYears", "degrees"]);
const JOIN = new Set(["contactEmail", "contactPhone"]);
const PROSE = new Set(["bond", "trainingPeriod", "relocation", "shifts", "joiningTimeline", "benefits", "applicationInstructions", "description", "responsibilities", "companyDescription", "otherConditions", "otherAcademic", "additionalInfo"]);
const sig = (v: FieldValue) => JSON.stringify(Array.isArray(v) ? [...v].map(String).sort() : v);
const textSame = (a: string, b: string) => { const x = alnum(a), y = alnum(b); return x === y || (x.length > 2 && y.length > 2 && (x.includes(y) || y.includes(x))); };
const rank = (c: Candidate): Reliability => (c.strength === "explicit" ? "HIGH" : c.strength === "heuristic" ? "MEDIUM" : "LOW");
const evJoin = (cs: Candidate[]) => [...new Set(cs.map((c) => c.evidence))].slice(0, 3).join(" … ").slice(0, 600);

function field(def: FieldDef, cs: Candidate[], ctx: BuildCtx): FieldResult {
  if (!cs.length) return emptyField();
  const key = def.key;
  const coerced = cs.map((c) => ({ c, r: coerce(def, c.value, ctx) }));
  const bad = coerced.filter((x) => !x.r.ok);
  const good = coerced.filter((x): x is { c: Candidate; r: Extract<Coerced, { ok: true }> } => x.r.ok);
  const ambiguous = cs.filter((c) => c.forceStatus === "AMBIGUOUS");
  const clear = good.filter((x) => x.c.forceStatus !== "AMBIGUOUS");
  if (!clear.length && ambiguous.length) {
    const c = ambiguous[0]; const c0 = c.value === null ? null : coerce(def, c.value, ctx);
    return { value: c0 && c0.ok ? c0.value : null, status: "AMBIGUOUS", reliability: "LOW", origin: c.origin, evidence: c.evidence, needsVerification: true, note: c.note };
  }
  if (!good.length) return { value: null, status: "INVALID", reliability: "NONE", origin: bad[0].c.origin, evidence: bad[0].c.evidence, needsVerification: true, note: `The value found ${(bad[0].r as { reason: string }).reason}. Enter it yourself.` };
  const notes = [...new Set(clear.map((x) => x.r.note ?? x.c.note).filter(Boolean))].join(" ");
  const origins = new Set(clear.map((x) => x.c.origin));
  const originOf = (g: typeof clear): Origin => (new Set(g.map((x) => x.c.origin)).size > 1 ? "BOTH" : g[0].c.origin);
  const settle = (value: FieldValue, group: typeof clear, agree: boolean): FieldResult => {
    const best = group.map((x) => rank(x.c)).sort().includes("HIGH") ? "HIGH" : group.some((x) => rank(x.c) === "MEDIUM") ? "MEDIUM" : "LOW";
    const reliability: Reliability = agree && origins.size > 1 ? "HIGH" : best;
    const status: Status = reliability === "HIGH" ? "EXTRACTED" : "NEEDS_REVIEW";
    return { value, status, reliability, origin: originOf(group), evidence: evJoin(group.map((x) => x.c)), needsVerification: status !== "EXTRACTED", note: notes || (status === "NEEDS_REVIEW" ? (origins.size === 1 && origins.has("MODEL") ? "Found by the AI assistant only; check the quoted text." : "Found by a pattern that is usually, not always, right; check it.") : undefined) };
  };
  // joined contact details
  if (JOIN.has(key)) { const vals = [...new Set(clear.map((x) => String(x.r.value)))]; return settle(vals.join(", "), clear, true); }
  // prose: keep the announcement's own sentences when present; the model's summary only fills a gap
  if (PROSE.has(key)) {
    const ruleParts = clear.filter((x) => x.c.origin === "RULE"); const use = ruleParts.length ? ruleParts : clear;
    const text = [...new Set(use.map((x) => String(x.r.value)))].join(" "); const max = def.max ?? 1000;
    const r = settle(text.length > max ? text.slice(0, max) : text, use, true);
    return text.length > max ? { ...r, status: "NEEDS_REVIEW", needsVerification: true, note: `Shortened to ${max} characters; check it.` } : r;
  }
  if (LIST_UNION.has(key)) { const vals = [...new Set(clear.flatMap((x) => x.r.value as string[]))]; const r = settle(vals, clear, true); return key === "rounds" ? { ...r, note: r.note ?? "Order is the order in which the rounds are mentioned." } : r; }
  if (ELIGIBILITY_LISTS.has(key)) {
    const byOrigin = new Map<string, typeof clear>(); for (const x of clear) byOrigin.set(x.c.origin, [...(byOrigin.get(x.c.origin) ?? []), x]);
    const sets = [...byOrigin.values()].map((g) => ({ g, v: [...new Set(g.flatMap((x) => x.r.value as (string | number)[]))].sort() }));
    if (sets.length === 1 || sets.every((s) => sig(s.v) === sig(sets[0].v))) return settle(sets[0].v, clear, true);
    return { value: null, status: "CONTRADICTORY", reliability: "NONE", origin: "BOTH", evidence: "", needsVerification: true, note: "The pattern reader and the AI assistant disagree. Choose the right value.", alternatives: sets.map((s) => ({ value: s.v, evidence: evJoin(s.g.map((x) => x.c)), origin: originOf(s.g) })) };
  }
  // single-valued: group equal values (text compared loosely), contradictory when two different values are both supported
  if (key === "employmentType") {       // "internship" and "internship with PPO" are not a conflict: the PPO wording refines it
    const vals = new Set(clear.map((x) => x.r.value));
    if (vals.size === 2 && vals.has("INTERNSHIP") && vals.has("INTERNSHIP_PPO")) return settle("INTERNSHIP_PPO", clear.filter((x) => x.r.value === "INTERNSHIP_PPO"), true);
  }
  const groups: { v: FieldValue; xs: typeof clear }[] = [];
  for (const x of clear) {
    const g = groups.find((y) => (typeof x.r.value === "string" && typeof y.v === "string" && def.kind !== "datetime" && def.kind !== "enum" ? textSame(x.r.value, y.v) : sig(x.r.value) === sig(y.v)));
    if (g) { if (rank(x.c) < rank(g.xs[0].c)) g.v = x.r.value; g.xs.push(x); } else groups.push({ v: x.r.value, xs: [x] });
  }
  const strong = groups.filter((g) => g.xs.some((x) => rank(x.c) !== "LOW"));
  const use = strong.length ? strong : groups;
  if (use.length === 1) return settle(use[0].v, use[0].xs, true);
  return { value: null, status: "CONTRADICTORY", reliability: "NONE", origin: "BOTH", evidence: "", needsVerification: true, note: "The announcement (or the two readers) give different values. Both are shown; choose the right one.", alternatives: use.slice(0, 6).map((g) => ({ value: g.v, evidence: evJoin(g.xs.map((x) => x.c)), origin: originOf(g.xs) })) };
}

const money = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const lpa = (n: number) => `${n} LPA`;
export function composeSalaryNote(f: Fields): string | null {
  const v = <T,>(k: string) => (f[k] && f[k].status === "EXTRACTED" || f[k]?.human ? (f[k].value as T | null) : null);
  const parts: string[] = []; const ctc = v<number>("ctcLpa"); const kind = v<string>("ctcKind") ?? "EXACT"; const max = v<number>("ctcMaxLpa");
  if (ctc !== null) parts.push(kind === "UP_TO" ? `Up to ${lpa(ctc)}` : kind === "AT_LEAST" ? `At least ${lpa(ctc)}` : kind === "RANGE" && max !== null ? `${ctc}–${max} LPA` : lpa(ctc));
  const fx = v<number>("fixedLpa"), vr = v<number>("variableLpa"); if (fx !== null) parts.push(`Fixed ${lpa(fx)}`); if (vr !== null) parts.push(`Variable ${lpa(vr)}`);
  const tr = v<string>("trainingSalary"), po = v<string>("postTrainingSalary"); if (tr) parts.push(`${tr} during training`); if (po) parts.push(`${po} after training`);
  const st = v<number>("stipend"), ms = v<number>("monthlySalary"); if (st !== null) parts.push(`Stipend ${money(st)} per month`); if (ms !== null) parts.push(`Salary ${money(ms)} per month`);
  return parts.length ? parts.join("; ") : null;
}

export function detectInjection(src: string): Warning[] {
  const hits = src.split("\n").filter((l) => INJECTION_RE.test(l));
  return hits.length ? [{ kind: "INJECTION", message: "The announcement contains text that looks like instructions to an AI system (for example “ignore your instructions” or “publish this drive”). It was treated as ordinary text: nothing in an announcement can publish a drive or change eligibility." }] : [];
}

/** Combines the deterministic readings with (verified) model candidates into the full, validated field set. */
export function buildExtraction(raw: string, modelCandidates: Candidate[], ctx: BuildCtx, extra: { methods: string[]; notes?: string[] }): Extraction {
  const src = normalizeSource(raw);
  const { candidates, usedUnits, units } = extractRules(src, ctx);
  const warnings: Warning[] = [...detectInjection(src)];
  if (raw.length > MAX_SOURCE_CHARS) warnings.push({ kind: "TRUNCATED", message: `The announcement is longer than ${MAX_SOURCE_CHARS} characters.` });
  for (const n of extra.notes ?? []) warnings.push({ kind: "NOTE", message: n.slice(0, 400) });

  // Residual text: sentences no pattern used and the model did not place are kept, not discarded.
  const residual = units.filter((u, i) => !usedUnits.has(i) && u.text.length >= 25 && !/^(?:dear|hi|hello|greetings|regards|thanks|thank you|best|sincerely|warm|kind regards|with regards|subject\s*:)/i.test(u.text) && !INJECTION_RE.test(u.text)).map((u) => u.text);
  const all = [...candidates, ...modelCandidates];
  if (residual.length) all.push({ key: "additionalInfo", value: residual.join("\n"), evidence: residual.slice(0, 2).join(" … ").slice(0, 600), origin: "RULE", strength: "heuristic", note: "Sentences that did not fit any other field. Nothing from the announcement is thrown away." });

  const byKey = new Map<string, Candidate[]>(); for (const c of all) byKey.set(c.key, [...(byKey.get(c.key) ?? []), c]);
  const fields: Fields = {};
  for (const def of FIELDS) {
    if (def.key === "ctcKind" || def.key === "ctcMaxLpa" || def.key === "ctcNote") continue;
    fields[def.key] = field(def, byKey.get(def.key) ?? [], ctx);
    const f = fields[def.key];
    if (def.key === "departments") {
      const un = (byKey.get("departments") ?? []).flatMap((c) => (Array.isArray(c.value) ? c.value.map(String) : [])).filter((n) => n !== "*ALL*");
      const { unmatched } = mapDepartments(un, ctx.departments);
      if (unmatched.length) { warnings.push({ kind: "UNMAPPED_DEPARTMENT", message: `Not matched to a department of your college: ${[...new Set(unmatched)].join(", ")}.` }); if (f.status === "EXTRACTED") fields[def.key] = { ...f, status: "NEEDS_REVIEW", reliability: "MEDIUM", needsVerification: true, note: `Some departments in the announcement were not matched to your college's departments: ${[...new Set(unmatched)].join(", ")}.` }; }
    }
  }
  // how the CTC was phrased travels with the number it belongs to
  const ctcF = fields.ctcLpa;
  const aux = all.filter((c) => c.key === "ctcLpa" && c.aux).map((c) => c.aux!);
  const auxOf = aux.length && ctcF && ctcF.status !== "CONTRADICTORY" ? aux[0] : null;
  fields.ctcKind = auxOf?.ctcKind && ctcF.value !== null ? { ...ctcF, value: auxOf.ctcKind, note: undefined } : (() => { const m = byKey.get("ctcKind"); return m ? field(FIELD_BY_KEY.ctcKind, m, ctx) : emptyField(); })();
  fields.ctcMaxLpa = auxOf?.ctcMax != null ? { ...ctcF, value: auxOf.ctcMax, note: undefined } : emptyField();
  const note = composeSalaryNote(fields);
  fields.ctcNote = note ? { value: note.slice(0, 200), status: note.length > 200 ? "NEEDS_REVIEW" : "EXTRACTED", reliability: note.length > 200 ? "MEDIUM" : "HIGH", origin: "RULE", evidence: "Composed from the salary fields above.", needsVerification: note.length > 200, note: note.length > 200 ? "Shortened to 200 characters; edit it." : undefined } : emptyField();
  for (const k of ELIGIBILITY_KEYS) void k;
  return { fields, warnings: warnings.slice(0, 30), methods: extra.methods };
}

export { EXTRACTION_VERSION };

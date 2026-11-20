import { classifyLinks } from "@/lib/evidence";
import { canonicalIdentifier } from "@/lib/normalize";
import { findDates, findTime, normalizeSource } from "@/lib/intake/rules";
import { istToIso } from "@/lib/announcements";
import type { Category } from "./classify";

/**
 * Reads the parts of a placement announcement that the announcement form holds (date, time, venue, rounds, per-batch venues, consent deadline, link, linked drive).
 * Pattern-based and conservative: every value carries the sentence it came from, nothing is guessed, and anything unclear is reported (AMBIGUOUS, CONTRADICTORY or
 * MISSING) instead of being filled in. A model never decides these; staff review the result before anything is published.
 */
export type Status = "EXTRACTED" | "NEEDS_REVIEW" | "MISSING" | "AMBIGUOUS" | "CONTRADICTORY";
export type AnnField<T = unknown> = { value: T | null; status: Status; evidence: string; note?: string; candidates?: string[] };
export type Batch = { name: string; venue: string; note: string | null };
export type DriveLite = { id: string; company_name: string; job_title: string; status: string };
export type AnnouncementExtraction = {
  title: AnnField<string>; company_name: AnnField<string>; event_date: AnnField<string>; event_time: AnnField<string>; venue: AnnField<string>;
  stages: AnnField<string[]>; batches: AnnField<Batch[]>; consent_deadline: AnnField<string>; action_link: AnnField<string>; instructions: AnnField<string>; summary: AnnField<string>;
  drive: AnnField<string>;
  warnings: string[];
};

const MISSING = (): AnnField<never> => ({ value: null, status: "MISSING", evidence: "Not provided in the message." });
const ok = <T>(value: T, evidence: string, status: Status = "EXTRACTED", note?: string): AnnField<T> => ({ value, status, evidence: evidence.replace(/\s+/g, " ").trim().slice(0, 300), ...(note ? { note } : {}) });
const alnum = (s: string) => s.normalize("NFKC").toLowerCase().replace(/\b(?:pvt|private|ltd|limited|inc|llp|technologies|technology|solutions|systems|info|it|services)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const lines = (src: string) => src.split("\n").map((l) => l.trim());
const BULLET = /^\s*(?:[-•*▪●○✔✅➤➢→]|\d+[.)]|[a-z][.)])\s+/;
const stripBullet = (l: string) => l.replace(BULLET, "").replace(/^[\p{Extended_Pictographic}\s]+/u, "").trim();
const label = (src: string, names: string[]) => {
  const re = new RegExp(String.raw`^\s*(?:[\p{Extended_Pictographic}\s]*)(?:${names.join("|")})\s*[:\-–]\s*(.+)$`, "imu");
  const m = re.exec(src); return m ? { value: m[1].trim(), line: m[0].trim() } : null;
};
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** One date for the event: a labelled "Date:" wins; otherwise the only date in the message; several unlabelled different dates are ambiguous, never picked. */
function eventDate(src: string, now: Date, warnings: string[]): AnnField<string> {
  const lab = label(src, ["date", "date of (?:the )?(?:drive|event|interview|test|training)", "event date", "interview date"]);
  const scope = lab ? lab.value : src;
  const hits = findDates(scope, now).filter((h) => !h.yearGuessed || lab);
  const distinct = [...new Set(hits.map((h) => h.date))];
  if (distinct.length === 0) {
    if (/\b(tomorrow|today|tonight|day after tomorrow|next (?:week|\w+day)|this \w+day)\b/i.test(src)) { warnings.push("The message gives a relative date (for example “tomorrow”). It is not resolved because the message has no reliable send date: enter the date yourself."); return { value: null, status: "AMBIGUOUS", evidence: (/\b(tomorrow|today|tonight|day after tomorrow|next (?:week|\w+day)|this \w+day)[^.\n]*/i.exec(src)?.[0] ?? "").trim(), note: "Relative date, not resolved." }; }
    return MISSING();
  }
  const first = hits[0];
  const ev = scope.slice(Math.max(0, first.index - 25), first.end + 20);
  if (distinct.length > 1 && !lab) return { value: null, status: "AMBIGUOUS", evidence: `Several dates: ${distinct.join(", ")}`, candidates: distinct, note: "More than one date and none is labelled as the event date." };
  const wd = new RegExp(String.raw`\b(${WEEKDAYS.join("|")})\b[^\n\d]{0,12}${scope.slice(first.index, first.end).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").exec(scope)
    ?? new RegExp(String.raw`${scope.slice(first.index, first.end).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\n\d]{0,12}\b(${WEEKDAYS.join("|")})\b`, "i").exec(scope);
  if (wd) {
    const named = WEEKDAYS.indexOf(wd[1].toLowerCase()); const real = new Date(`${first.date}T00:00:00Z`).getUTCDay();
    if (named !== real) warnings.push(`The message says ${wd[1]} but ${first.date} is a ${WEEKDAYS[real][0].toUpperCase()}${WEEKDAYS[real].slice(1)}. Check the date.`);
  }
  return ok(first.date, lab ? lab.line : ev, first.yearGuessed ? "NEEDS_REVIEW" : "EXTRACTED", first.yearGuessed ? "The year was not written; it was taken from today's date." : undefined);
}

function timeOf(src: string): AnnField<string> {
  const lab = label(src, ["time", "reporting time", "timing", "start time", "at"]);
  const scope = lab ? lab.value : src;
  const m = /\b\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)(?![a-z])/i.exec(scope);
  if (m) return ok(m[0].replace(/\s+/g, " ").toUpperCase().replace(/\./g, (d, i, s) => (/\d/.test(s[i - 1] ?? "") && /\d/.test(s[i + 1] ?? "") ? "." : "")), lab ? lab.line : scope.slice(Math.max(0, m.index - 20), m.index + m[0].length + 10), "EXTRACTED", findTime(m[0]) ? undefined : undefined);
  const hhmm = findTime(scope);
  return hhmm && lab ? ok(lab.value, lab.line, "NEEDS_REVIEW", "A 24-hour time; check it.") : MISSING();
}

/** "Batch 1: CC1 & CC2" (or "Batch 1 | CC1 and CC2"): one entry per batch, venue kept as written (class codes in capitals). */
function batchesOf(src: string, warnings: string[]): AnnField<Batch[]> {
  const out: Batch[] = []; const ev: string[] = []; const seen = new Set<string>(); let dup = false;
  for (const raw of lines(src)) {
    const m = /^(?:[\p{Extended_Pictographic}\s]*)(?:[-•*]\s*)?(batch\s*[-#]?\s*([0-9]+|[a-z]))\s*[:|\-–]\s*(.+)$/iu.exec(raw);
    if (!m) continue;
    const name = `Batch ${m[2].toUpperCase()}`; const venue = m[3].replace(/\b(cc|cr|lab|room|hall)\s?-?(\d+)\b/gi, (_x, a, b) => `${canonicalIdentifier(a)}${b}`).trim();
    if (seen.has(name.toLowerCase())) dup = true; seen.add(name.toLowerCase());
    out.push({ name, venue, note: null }); ev.push(raw);
  }
  if (!out.length) return MISSING();
  if (dup) { warnings.push("The same batch appears twice with different venues. Check the batch list."); return { value: out, status: "CONTRADICTORY", evidence: ev.join(" / ").slice(0, 300), note: "A batch is listed more than once." }; }
  return ok(out, ev.join(" / "));
}

const HEAD_RE = /^(?:[\p{Extended_Pictographic}\s]*)(?:interview\s*process|recruitment\s*process|selection\s*process|rounds?|process|stages?|steps?|agenda|schedule|selection procedure)\s*[:\-–]?\s*$/iu;
/** The list under an "Interview Process" style heading, in order. */
function stagesOf(src: string): AnnField<string[]> {
  const ls = lines(src); const i = ls.findIndex((l) => HEAD_RE.test(l));
  const inline = label(src, ["interview process", "recruitment process", "selection process", "rounds"]);
  const out: string[] = [];
  if (i >= 0) { for (let j = i + 1; j < ls.length; j++) { const l = ls[j]; if (!l) { if (out.length) break; continue; } if (!BULLET.test(l) && out.length === 0 && /:\s*$/.test(l)) break; if (!BULLET.test(l) && out.length) break; const s = stripBullet(l); if (s) out.push(s); } }
  else if (inline) for (const part of inline.value.split(/\s*(?:,|;|→|->|>|\bthen\b)\s*/i)) if (part.trim()) out.push(part.trim());
  if (!out.length) return MISSING();
  return ok(out.slice(0, 15).map((s) => s.slice(0, 120)), i >= 0 ? ls[i] + " …" : inline!.line, out.length > 15 ? "NEEDS_REVIEW" : "EXTRACTED", out.length > 15 ? "More than 15 stages; only the first 15 are kept." : undefined);
}

function companyOf(src: string): AnnField<string> {
  const lab = label(src, ["name of (?:the )?company", "company(?: name)?", "organi[sz]ation"]);
  if (lab) return ok(lab.value.replace(/[.,;]+$/, ""), lab.line);
  const ls = lines(src);
  for (const l of ls.slice(0, 8)) {
    const a = /^([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*){0,4})\s+(?:[Ss]tudents?|[Cc]andidates?)\b/.exec(l);                  // "HCL Students – Cloud Training"
    if (a && !/^(final|third|second|first|all|the|our|registered|shortlisted)\b/i.test(a[1])) return ok(a[1], l, "NEEDS_REVIEW", "Read from the way the heading is written; check it.");
    const b = /\b([A-Z][\w&.\-]*(?:\s+[A-Z][\w&.\-]*){0,4})\s+(?:is hiring|are hiring|has offered|is offering|offers|is conducting|will conduct|invites)\b/.exec(l);
    if (b) return ok(b[1], l, "NEEDS_REVIEW", "Read from the sentence; check it.");
  }
  return MISSING();
}

function consentOf(src: string, now: Date): AnnField<string> {
  const near = lines(src).find((l) => /\b(consent|confirm|confirmation|reply|respond|revert|willing)\b/i.test(l) && findDates(l, now).length > 0);
  if (!near) return MISSING();
  const d = findDates(near, now)[0]; const t = findTime(near);
  if (!t) return { value: null, status: "AMBIGUOUS", evidence: near.slice(0, 300), note: `Deadline date ${d.date} found but no time; enter the time yourself.` };
  const iso = `${d.date}T${t}`; return istToIso(iso) ? ok(iso, near, d.yearGuessed ? "NEEDS_REVIEW" : "EXTRACTED", d.yearGuessed ? "The year was not written." : undefined) : MISSING();
}

const FACT_RE = /\b(ctc|lpa|salary|stipend|package|internship|duration|fte|full[- ]time|shift|relocat|service agreement|bond|repay|₹|rs\.?\s*\d|designation|role|position|location|work from|locations?|networks?|trainee|period)\b/i;
const INSTR_RE = /\b(kindly|please|ensure|must|should|bring|carry|report|inform|reach|submit|attend|confirm|reply|wear|dress|carry|punctual|on time)\b/i;

export function extractAnnouncement(raw: string, category: Category, ctx: { now: Date; drives?: DriveLite[] }): AnnouncementExtraction {
  const src = normalizeSource(raw); const warnings: string[] = []; const all = lines(src);
  const company = companyOf(src);
  const titleLine = all.find((l) => l.replace(/[\p{Extended_Pictographic}\s!.\-–:]/gu, "").length >= 3) ?? "";
  const title = titleLine ? ok(stripBullet(titleLine).replace(/[!.:]+$/, "").slice(0, 150), titleLine, "NEEDS_REVIEW", "The first line of the message; edit it if a clearer title helps students.") : MISSING();
  const links = classifyLinks(raw);
  const form = links.find((l) => l.purpose === "REGISTRATION_FORM");
  const others = links.filter((l) => l !== form);
  if (others.length) warnings.push(`${others.length} other link${others.length === 1 ? "" : "s"} in the message ${others.length === 1 ? "was" : "were"} not used as the action link: ${others.map((l) => l.url).slice(0, 3).join(", ")}`);
  const event = category === "ALTERNATE_ROLE_CONSENT" && !label(src, ["date"]) ? MISSING() : eventDate(src, ctx.now, warnings);
  const batches = category === "TRAINING_VENUE" || /\bbatch\s*[-#]?\s*\w+\s*[:|\-–]/i.test(src) ? batchesOf(src, warnings) : MISSING();
  const venue = label(src, ["venue", "location", "place", "hall"]);
  const venueF: AnnField<string> = venue ? ok(venue.value, venue.line) : MISSING();
  const stages = stagesOf(src);

  // facts worth keeping word for word (pay, duration, conditions): they become the structured summary, never rephrased
  const used = new Set<string>([...(batches.value ?? []).map((b) => b.name), titleLine]);
  const facts = all.filter((l) => l && !used.has(l) && !BULLET.test(l) && FACT_RE.test(l) && l.length < 300 && !/^(?:venue|date|time)\b/i.test(l));
  const summaryLines = category === "TRAINING_VENUE" ? all.filter((l, i) => l && i > 0 && !/^batch\b/i.test(l) && !INSTR_RE.test(l) && l.length < 200 && l !== titleLine).slice(0, 4) : facts;
  const instr = all.filter((l) => l && INSTR_RE.test(l) && l.length < 400 && !summaryLines.includes(l));
  if (category === "ALTERNATE_ROLE_CONSENT") {
    if (/\b(may|might|could|will be|would be)\b[^.\n]{0,60}\b(consider|considered|convert|conversion|absorb)/i.test(src) || /\bFTE\b/i.test(src)) warnings.push("Any full-time (FTE) opportunity in this message is conditional. Keep the wording as written; do not describe it as a guaranteed job offer.");
    warnings.push("This goes only to the candidates the company named. Choose the recipients yourself: a list in an attachment is never used automatically.");
  }
  if (/\b(attached|attachment|enclosed|list attached)\b/i.test(src)) warnings.push("The message mentions an attachment. Attachments are not read here: add the file yourself and confirm any student list before using it.");

  // link to an existing drive by company name: exactly one non-draft match is suggested; several are left for staff to choose
  let drive: AnnField<string> = MISSING();
  if (company.value && ctx.drives?.length) {
    const key = alnum(company.value);
    const hit = key ? ctx.drives.filter((d) => d.status !== "DRAFT" && (alnum(d.company_name) === key || (key.length > 2 && (alnum(d.company_name).includes(key) || key.includes(alnum(d.company_name)) && alnum(d.company_name).length > 2)))) : [];
    if (hit.length === 1) drive = ok(hit[0].id, `${hit[0].company_name} — ${hit[0].job_title}`, "NEEDS_REVIEW", "A drive of this company already exists. Confirm it is the right one.");
    else if (hit.length > 1) drive = { value: null, status: "AMBIGUOUS", evidence: hit.map((d) => `${d.company_name} — ${d.job_title}`).join(" / ").slice(0, 300), candidates: hit.map((d) => d.id), note: "Several drives of this company: choose one." };
    else drive = { value: null, status: "MISSING", evidence: `No existing drive found for “${company.value}”.`, note: "This will be saved as a standalone announcement unless you pick a drive." };
  }
  return {
    title, company_name: company, event_date: event, event_time: category === "ALTERNATE_ROLE_CONSENT" && !label(src, ["time"]) ? MISSING() : timeOf(src), venue: venueF, stages, batches,
    consent_deadline: category === "ALTERNATE_ROLE_CONSENT" ? consentOf(src, ctx.now) : MISSING(),
    action_link: form ? ok(form.url, form.url, "NEEDS_REVIEW", "Looks like a form or registration link; check it before students use it.") : MISSING(),
    instructions: instr.length ? ok(instr.join("\n"), instr[0]) : MISSING(),
    summary: summaryLines.length ? ok(summaryLines.join("\n"), summaryLines[0], "NEEDS_REVIEW", "Lines kept word for word from the message; edit as needed.") : MISSING(),
    drive, warnings,
  };
}

/** The values safe to pre-fill: only settled fields (never AMBIGUOUS or CONTRADICTORY), shaped like the announcement save function expects. */
export function prefill(x: AnnouncementExtraction): Record<string, unknown> {
  const f: Record<string, unknown> = {};
  const settled = <T,>(a: AnnField<T>) => (a.status === "EXTRACTED" || a.status === "NEEDS_REVIEW") && a.value !== null;
  if (settled(x.company_name)) f.company_name = x.company_name.value;
  if (settled(x.title)) f.title = x.title.value;
  if (settled(x.event_date)) f.event_date = x.event_date.value;
  if (settled(x.event_time)) f.event_time = x.event_time.value;
  if (settled(x.venue)) f.venue = x.venue.value;
  if (settled(x.stages)) f.stages = x.stages.value;
  if (settled(x.batches)) f.batches = x.batches.value;
  if (settled(x.consent_deadline)) f.consent_deadline = istToIso(x.consent_deadline.value as string);
  if (settled(x.action_link)) f.action_link = x.action_link.value;
  if (settled(x.instructions)) f.instructions = x.instructions.value;
  if (settled(x.summary)) f.summary = x.summary.value;
  if (settled(x.drive)) f.drive_id = x.drive.value;
  return f;
}

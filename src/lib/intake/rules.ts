import { istToIso } from "../drives";
import { FIELD_BY_KEY, type FieldValue } from "./catalog";
import { mentionsIn, saysAllBranches } from "./departments";

/**
 * Layer 1 — deterministic extraction. Plain patterns over the announcement; no model, no network. Each result carries the exact sentence it came
 * from. "explicit" = a labelled or unambiguous statement; "heuristic" = a pattern that usually, but not always, means what we think (a person confirms).
 */
export type Strength = "explicit" | "heuristic" | "weak";
export type Candidate = {
  key: string; value: FieldValue; evidence: string; origin: "RULE" | "MODEL"; strength: Strength; note?: string;
  /** The text itself leaves it open (e.g. "no arrears": active or all?). The value is only a suggestion until a person decides. */
  forceStatus?: "AMBIGUOUS";
  /** Extra structured detail that travels with a value (e.g. how a CTC was phrased); never shown as text. */
  aux?: { ctcKind?: string; ctcMax?: number | null };
};

export function normalizeSource(raw: string): string {
  return raw.normalize("NFKC").replace(/[​-‍﻿⁠]/g, "").replace(/[   ]/g, " ").replace(/\r\n?/g, "\n")
    .replace(/[*~`]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

export const INJECTION_RE = /note to (?:the )?(?:ai|assistant|model|llm)|(?:mark|set|make|treat)\s+(?:all|every|each|any)\b[^.\n]{0,60}\b(?:eligible|eligibility)|set\s+(?:the\s+)?(?:minimum\s+)?(?:cgpa|criteria)\s+to\s+(?:0|zero|none)|(?:^|\n)\s*\[?\s*(?:system|assistant|developer)\s*(?:message|prompt)?\s*[:\]]|ignore (?:all |any |the |your |previous |prior |above |these )*(?:instructions|rules|prompt)|disregard (?:all |previous |the |your )*(?:instructions|above|rules)|system prompt|you are now\b|\bact as\b|developer message|publish (?:this|the) drive|mark (?:every|all) students? (?:as )?eligible|(?:reveal|print|show|send) (?:your|the) (?:prompt|secrets?|api key|password)|execute (?:sql|the following|this command)|drop table|<\/?script|jailbreak/i;

export type Unit = { text: string; start: number };
/** Lines, then sentences. Abbreviations like "Rs." or "B.E." do not end a sentence (a full stop must follow 4+ letters or digits). */
export function splitUnits(src: string): Unit[] {
  const out: Unit[] = []; let pos = 0;
  for (const line of src.split("\n")) {
    const lineStart = pos; pos += line.length + 1;
    const parts = line.split(/(?<=\w{3,}[.!?])(?<!\b(?:Pvt|Ltd|Inc|Corp|Dept|Prof|Govt|approx|etc|Eng|Sr|Jr)[.])\s+(?=[A-Z0-9₹•(\-])/);
    let off = 0;
    for (const p of parts) {
      const i = line.indexOf(p, off); off = i + p.length;
      const text = p.replace(/^\s*(?:[•·▪●>–—-]|\d{1,2}[.)])\s+/, "").trim();
      if (text) out.push({ text, start: lineStart + i });
    }
  }
  return out;
}

const AMT = String.raw`\d{1,3}(?:,\d{2,3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const LPA = String.raw`(?:lpa|l\.p\.a\.?|lakhs?(?:\s*per\s*(?:annum|year|anum))?|lacs?(?:\s*(?:pa|per annum))?|lakhs? p\.?a\.?)`;
const PER_MONTH = String.raw`(?:per\s*(?:month|mnth)|\/\s*month|monthly|a month)`;
const RUPEE = String.raw`(?:₹|rs\.?|inr)?\s*`;
const num = (s: string) => Number(s.replace(/,/g, ""));
const cap = (s: string, n = 600) => (s.length <= n ? s : `${s.slice(0, n - 1)}…`);

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const MONTH_RE = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const pad = (n: number) => String(n).padStart(2, "0");

type DateHit = { index: number; end: number; date: string; yearGuessed: boolean };
/** Finds calendar dates in a sentence. A missing year is filled with the next occurrence after `now` (Indian time) and flagged as guessed. */
export function findDates(text: string, now: Date): DateHit[] {
  const todayIst = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(now);
  const [ty] = todayIst.split("-").map(Number);
  const hits: DateHit[] = [];
  const push = (index: number, len: number, d: number, m: number, y: number | null) => {
    let year = y ?? ty; const guessed = y === null;
    if (y !== null && y < 100) year = 2000 + y;
    let s = `${year}-${pad(m)}-${pad(d)}`;
    if (guessed && s < todayIst) { year += 1; s = `${year}-${pad(m)}-${pad(d)}`; }
    if (istToIso(`${s}T00:00`) === null) return;       // impossible dates (30 February) are not dates
    hits.push({ index, end: index + len, date: s, yearGuessed: guessed });
  };
  for (const m of text.matchAll(new RegExp(String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s\-/.,]*(?:of\s+)?${MONTH_RE}[a-z]*\.?(?:[\s,\-/.]*(\d{4}|\d{2})\b)?`, "gi"))) push(m.index!, m[0].length, +m[1], MONTHS[m[2].slice(0, 3).toLowerCase()], m[3] ? +m[3] : null);
  for (const m of text.matchAll(new RegExp(String.raw`\b${MONTH_RE}[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?:,?\s*(\d{4}))?`, "gi"))) {
    if (!hits.some((h) => m.index! >= h.index && m.index! < h.end)) push(m.index!, m[0].length, +m[2], MONTHS[m[1].slice(0, 3).toLowerCase()], m[3] ? +m[3] : null);
  }
  for (const m of text.matchAll(/\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/g)) push(m.index!, m[0].length, +m[1], +m[2], +m[3]);       // Indian order: day/month/year
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(m.index!, m[0].length, +m[3], +m[2], +m[1]);
  return hits.sort((a, b) => a.index - b.index).filter((h, i, all) => !all.some((o, j) => j < i && h.index < o.end));
}
export function findTime(text: string): string | null {
  const a = text.match(/\b(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?![a-z])/i);       // "9.10 AM" is 9:10, not 10 AM
  if (a) { let h = +a[1]; const mm = a[2] ? +a[2] : 0; if (h < 1 || h > 12 || mm > 59) return null; const pm = a[3].toLowerCase().startsWith("p"); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; return `${pad(h)}:${pad(mm)}`; }
  const b = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  return b ? `${pad(+b[1])}:${b[2]}` : null;
}

const DATE_KEYS: { key: string; re: RegExp }[] = [
  { key: "deadline", re: /last date|deadline|apply (?:by|before|on or before|till|until)|regist(?:er|ration)s? (?:by|before|till|until|closes?|ends?)|applications? (?:close|closes|closing|end|ends)|closing date|on or before|submit (?:by|before)|last day/i },
  { key: "applicationOpens", re: /applications? (?:open|opens|start|starts|begin|begins)|regist(?:er|ration)s? (?:opens|starts|begins)|opening date|open(?:s)? from|registration from/i },
  { key: "preplacementTalk", re: /pre[- ]?placement (?:talk|presentation)|\bppt\b|company presentation/i },
  { key: "recruitmentDate", re: /(?:date of|dates of)\s*(?:the\s*)?(?:drive|recruitment|interviews?|test|assessment|selection)|(?:drive|recruitment|interviews?|written test|online test|assessment|selection process|campus drive)\s*(?:date|on|will be held|scheduled|is on)|will be (?:held|conducted) on|scheduled (?:on|for)|recruitment drive/i },
];
const RELATIVE = /\b(today|tonight|tomorrow|day after tomorrow|this (?:mon|tues|wednes|thurs|fri|satur|sun)day|next (?:week|month|(?:mon|tues|wednes|thurs|fri|satur|sun)day)|coming (?:mon|tues|wednes|thurs|fri|satur|sun)day|within \d+ (?:days?|hours?)|end of (?:the )?(?:week|month)|next few days)\b/i;

export function extractRules(src: string, ctx: { now: Date; departments: { id: string; code: string; name: string }[] }): { candidates: Candidate[]; usedUnits: Set<number>; units: Unit[] } {
  const units = splitUnits(src); const out: Candidate[] = []; const used = new Set<number>();
  const add = (i: number, c: Omit<Candidate, "origin" | "evidence"> & { evidence?: string }) => { const { evidence, ...rest } = c; out.push({ ...rest, origin: "RULE", evidence: cap(evidence ?? units[i].text) }); used.add(i); };

  units.forEach((u, i) => {
    const t = u.text; const lower = t.toLowerCase();
    if (INJECTION_RE.test(t)) return;        // an instruction aimed at an AI is not announcement content; it feeds no field (the text itself is kept and flagged)

    // ── labelled single-value fields ──
    const label = (key: string, re: RegExp, strength: Strength = "explicit") => { const m = t.match(re); if (m?.[1]) { const v = m[1].trim().replace(/[.;,]+$/, ""); if (v.length >= 2) add(i, { key, value: v, strength }); } };
    label("company", /^(?:name of (?:the )?)?(?:company|organi[sz]ation|firm|employer)(?: name)?\s*[:–-]\s*(.{2,100})$/i);
    { const m = t.match(/^(?:job )?(?:role|position|designation|job title|post|profile|job role)\s*[:–-]\s*(.{2,100})$/i); if (m) { const v = m[1].replace(/\s*\([^)]*(?:month|year|week|full|part|contract|intern|\d)[^)]*\)\s*\.?$/i, "").trim().replace(/[.;,]+$/, ""); if (v.length >= 2) add(i, { key: "title", value: v, strength: "explicit" }); } }
    { const m = t.match(/^(?:work |job |posting )?(?:location|place of work|work location)\s*[:–-]\s*(.{2,100})$/i); if (m && !/^(?:remote|work from home|wfh|hybrid|on[- ]?site|anywhere)\b[.\s]*$/i.test(m[1].trim())) label("location", /^(?:work |job |posting )?(?:location|place of work|work location)\s*[:–-]\s*(.{2,100})$/i); }
    label("venue", /^venue\s*[:–-]\s*(.{2,250})$/i);
    label("industry", /^(?:industry|domain|sector)\s*[:–-]\s*(.{2,100})$/i);
    if (!out.some((c) => c.key === "company")) {
      const m = t.match(/\b([A-Z][\w&.'-]*(?:\s+[A-Z&][\w&.'-]*){0,4})\s+(?:is|are)\s+(?:hiring|recruiting|conducting|visiting|looking for|inviting|organi[sz]ing)\b/);
      if (m && !/^(?:We|Our|The|This|That|Company|Dear|Hi|Hello|Greetings|Students|Candidates|They|It|Who|Everyone)$/.test(m[1].split(" ")[0])) add(i, { key: "company", value: m[1].replace(/^M\/s\.?\s*/, ""), strength: "heuristic" });
    }
    if (!out.some((c) => c.key === "company") && i < 3) {
      const m = t.match(/^\W*(?:[A-Za-z]+-type drive\W*)?([A-Z][\w&.'-]*(?:\s+[A-Z&][\w&.'-]*){0,3})\s*(?:[-–—:|]\s*)?(?:campus\s+(?:hiring|recruitment|drive)|off[- ]campus|hiring|invites?\b|recruitment drive|placement drive)/);
      if (m && !/^(?:Campus|Placement|Dear|Subject|Recruitment|Hiring|Greetings|Notification|Urgent|Important|New|Job|Company|Forwarded|From)\b/.test(m[1])) add(i, { key: "company", value: m[1].trim(), strength: "heuristic" });
    }
    {
      const m = t.match(/\b(?:hiring|recruiting|looking for|invites? applications? for)\s+(?:for\s+)?(?:the\s+(?:position|role|post) of\s+)?([A-Z][\w+#/&.-]*(?:\s+[A-Z&][\w+#/&.-]*){0,4})(?=\s+(?:at|for|in|with|from|to|\(|,|\.|-|–|—)|\s*$)/);
      if (m && !/^(?:Freshers?|Students?|Candidates?|Engineers?|Graduates?|Talented|Bright|Passionate)$/.test(m[1])) add(i, { key: "title", value: m[1], strength: "heuristic" });
    }

    // ── contact details ──
    for (const m of t.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g)) add(i, { key: "contactEmail", value: m[0], strength: "explicit" });
    for (const m of t.matchAll(/(?<![\d.])(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}(?!\d)/g)) add(i, { key: "contactPhone", value: m[0].replace(/[\s-]/g, ""), strength: "explicit" });
    { const m = t.match(/(?:[Cc]ontact(?: [Pp]erson)?|[Pp]oint of [Cc]ontact|POC|[Rr]ecruiter|HR [Cc]ontact)\s*[:–-]?\s*(?:Mr\.?|Ms\.?|Mrs\.?|Dr\.?)?\s*([A-Z][a-z]+(?:\s[A-Z][a-z]+){0,2})(?![a-z])/); if (m) add(i, { key: "contactName", value: m[1], strength: "heuristic" }); }
    for (const m of t.matchAll(/\bhttps?:\/\/[^\s<>"')\]]+|\bwww\.[^\s<>"')\]]+/gi)) {
      const url = m[0].replace(/[.,;:!?]+$/, "");
      let host = ""; try { host = new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.toLowerCase(); } catch { continue; }
      const meeting = /(?:^|\.)(?:meet\.google\.com|zoom\.us|teams\.microsoft\.com|teams\.live\.com|webex\.com)$/.test(host);
      const form = /(?:^|\.)(?:forms\.gle|forms\.office\.com|typeform\.com)$/.test(host) || /docs\.google\.com\/forms/i.test(url) || /regist|apply|form|sign ?up|link/i.test(t);
      if (meeting) add(i, { key: "meetingLink", value: url, strength: "explicit" });
      else if (form) add(i, { key: "registrationLink", value: url, strength: "explicit" });
      else if (/website|visit|know more|about us|www/i.test(t)) add(i, { key: "website", value: url, strength: "heuristic" });
    }

    // ── employment, mode, experience, openings ──
    if (/intern/i.test(t) && /\bppo\b|pre[- ]?placement offer|conversion|convert(?:ed)? (?:in)?to (?:a )?full/i.test(t)) add(i, { key: "employmentType", value: "INTERNSHIP_PPO", strength: "explicit" });
    else if (/\bintern(?:ship)?s?\b/i.test(t) && !/full[- ]?time/i.test(t)) add(i, { key: "employmentType", value: "INTERNSHIP", strength: "heuristic" });
    else if (/full[- ]?time|permanent (?:role|position|employee)|regular employee/i.test(t) && !/intern/i.test(t)) add(i, { key: "employmentType", value: "FULL_TIME", strength: "explicit" });
    else if (/\bcontract(?:ual)?\b/i.test(t) && /role|basis|position|employment|hire|hiring/i.test(t)) add(i, { key: "employmentType", value: "CONTRACT", strength: "heuristic" });
    if (/work from home|\bwfh\b|\bfully remote\b|\bremote (?:work|role|position|job)\b|\bremote\b/i.test(t) && !/not remote|no remote/i.test(t)) add(i, { key: "workMode", value: /hybrid/i.test(t) ? "HYBRID" : "REMOTE", strength: /hybrid/i.test(t) ? "explicit" : "heuristic" });
    else if (/\bhybrid\b/i.test(t)) add(i, { key: "workMode", value: "HYBRID", strength: "explicit" });
    else if (/\bon[- ]?site\b|work from office|\bwfo\b|office[- ]based/i.test(t)) add(i, { key: "workMode", value: "ONSITE", strength: "explicit" });
    if (/\bfreshers?\b/i.test(t) && /experienced|\d+\+?\s*years/i.test(t)) add(i, { key: "experience", value: "BOTH", strength: "heuristic" });
    else if (/\bfreshers?\b|\b0\s*(?:-|to)\s*1\s*years?\b|no experience (?:required|needed)/i.test(t)) add(i, { key: "experience", value: "FRESHER", strength: "explicit" });
    { const m = t.match(/(\d+\+?(?:\s*(?:-|to)\s*\d+)?\s*years?(?: of)?\s*(?:relevant |work |industry |professional )?experience)/i); if (m) { add(i, { key: "experienceNote", value: m[1], strength: "explicit" }); add(i, { key: "experience", value: "EXPERIENCED", strength: "heuristic" }); } }
    { const m = t.match(new RegExp(String.raw`(\d{1,5})\s*\+?\s*(?:openings?|vacanc(?:y|ies)|positions?|seats?|posts?)\b`, "i")) ?? t.match(/(?:openings?|vacanc(?:y|ies)|positions?)\s*[:–-]\s*(\d{1,5})\b/i); if (m && Number(m[1]) >= 1) add(i, { key: "openings", value: Number(m[1]), strength: "explicit" }); }

    // ── salary ──
    const spans: [number, number][] = []; const taken = (a: number, b: number) => spans.some(([x, y]) => a < y && b > x);
    const mark = (m: RegExpMatchArray) => spans.push([m.index!, m.index! + m[0].length]);
    const stats = /last year|previous year|highest|average|avg\b|record|achieved|already placed|were placed|was placed/i.test(t);
    const inr = (s: string, k?: string) => (k ? num(s) * 1000 : num(s));
    for (const re of [new RegExp(String.raw`(${RUPEE}(${AMT}))\s*${LPA}?\s*(?:during|in|for)\s*(?:the\s*)?(?:training|probation(?:ary)?|internship|initial)`, "i"), new RegExp(String.raw`(?:during|in)\s*(?:the\s*)?(?:training|probation(?:ary)?)[^0-9₹]{0,20}(${RUPEE}(${AMT}))\s*(${LPA}|${PER_MONTH})?`, "i")]) {
      const m = t.match(re); if (m) { mark(m); const unit = /per|month|pm|\//i.test(m[0]) && !new RegExp(LPA, "i").test(m[0]) ? "per month" : "LPA"; add(i, { key: "trainingSalary", value: `${unit === "LPA" ? "" : "₹"}${m[2]} ${unit}`, strength: "explicit" }); break; }
    }
    for (const re of [new RegExp(String.raw`(${RUPEE}(${AMT}))\s*${LPA}?\s*(?:after(?:ward)?s?|post|upon|once|thereafter|following|on confirmation)\b`, "i"), new RegExp(String.raw`(?:after|post)[- ]?\s*(?:the\s*)?(?:training|probation(?:ary)?|confirmation)[^0-9₹]{0,25}(${RUPEE}(${AMT}))\s*(${LPA}|${PER_MONTH})?`, "i")]) {
      const m = t.match(re); if (m && /train|probation|confirm/i.test(t)) { mark(m); const unit = /per|month|pm|\//i.test(m[0]) && !new RegExp(LPA, "i").test(m[0]) ? "per month" : "LPA"; add(i, { key: "postTrainingSalary", value: `${unit === "LPA" ? "" : "₹"}${m[2]} ${unit}`, strength: "explicit" }); break; }
    }
    for (const [key, re] of [["fixedLpa", new RegExp(String.raw`(${AMT})\s*${LPA}\s*(?:as\s*)?fixed|fixed[^0-9₹]{0,25}(${AMT})\s*${LPA}`, "i")], ["variableLpa", new RegExp(String.raw`(${AMT})\s*${LPA}\s*(?:as\s*)?variable|variable[^0-9₹]{0,25}(${AMT})\s*${LPA}`, "i")]] as const) {
      const m = t.match(re); if (m && !taken(m.index!, m.index! + m[0].length)) { mark(m); add(i, { key, value: num(m[1] ?? m[2]), strength: "explicit" }); }
    }
    for (const m of t.matchAll(new RegExp(String.raw`(${RUPEE}(${AMT}))\s*(k)?\s*(?:\/-)?\s*${PER_MONTH}`, "gi"))) {
      if (taken(m.index!, m.index! + m[0].length)) continue;
      mark(m); const amount = inr(m[2], m[3]);
      add(i, { key: /stipend|intern/i.test(t) ? "stipend" : "monthlySalary", value: amount, strength: "explicit", note: "A monthly amount. It was NOT converted to an annual package." });
    }
    { const m = t.match(new RegExp(String.raw`stipend[^0-9₹]{0,25}(?:of\s*)?${RUPEE}(${AMT})\s*(k)?(?!\s*${LPA})`, "i")); if (m && !taken(m.index!, m.index! + m[0].length) && !out.some((c) => c.key === "stipend" && c.evidence === t)) { mark(m); add(i, { key: "stipend", value: inr(m[1], m[2]), strength: "heuristic", note: "Assumed to be per month." }); } }
    if (!stats) {
      const range = t.match(new RegExp(String.raw`(${AMT})\s*(?:-|–|—|to)\s*(${AMT})\s*${LPA}`, "i"));
      const upto = t.match(new RegExp(String.raw`(?:up\s*to|upto|maximum(?: of)?|max\.?|as high as|not exceeding|upper limit of)\s*${RUPEE}(${AMT})\s*${LPA}`, "i"));
      const atleast = t.match(new RegExp(String.raw`(?:minimum|at least|starting (?:from|at)|starts? (?:from|at)|from)\s*${RUPEE}(${AMT})\s*${LPA}`, "i"));
      const exact = [...t.matchAll(new RegExp(String.raw`(${RUPEE}(${AMT}))\s*${LPA}`, "gi"))].find((m) => !taken(m.index!, m.index! + m[0].length) && !(range && m.index! >= range.index! && m.index! < range.index! + range[0].length));
      const ctc = (kind: string, a: number, b?: number, m?: RegExpMatchArray) => { if (m && taken(m.index!, m.index! + m[0].length)) return; if (m) mark(m); add(i, { key: "ctcLpa", value: a, strength: "explicit", aux: { ctcKind: kind, ctcMax: b ?? null } }); };
      if (range && !taken(range.index!, range.index! + range[0].length)) ctc("RANGE", num(range[1]), num(range[2]), range);
      else if (upto && !taken(upto.index!, upto.index! + upto[0].length)) ctc("UP_TO", num(upto[1]), undefined, upto);
      else if (atleast && !taken(atleast.index!, atleast.index! + atleast[0].length) && /ctc|package|salary|compensation|lpa/i.test(t)) ctc("AT_LEAST", num(atleast[1]), undefined, atleast);
      else if (exact && /ctc|package|salary|compensation|offer|remuneration|annual|lpa|lakhs?/i.test(t)) ctc("EXACT", num(exact[2]), undefined, exact);
      else {
        const rupees = t.match(/(?:ctc|package|salary)\s*(?:of|:|is|-)?\s*(?:₹|rs\.?|inr)\s*(\d[\d,]{5,})/i);
        if (rupees && !taken(rupees.index!, rupees.index! + rupees[0].length)) add(i, { key: "ctcLpa", value: num(rupees[1]) / 100000, strength: "heuristic", aux: { ctcKind: "EXACT", ctcMax: null }, note: "Converted from a full rupee amount to lakhs per annum. Check it." });
      }
    }
    { const m = t.match(/\b(?:benefits?|perks|insurance|health cover|joining bonus|relocation (?:allowance|bonus)|esop)s?\b[^.]{0,200}/i); if (m && /benefit|perk|insurance|bonus|allowance|esop|health/i.test(m[0])) add(i, { key: "benefits", value: cap(t, 800), strength: "heuristic" }); }

    // ── academic eligibility ──
    if (/\b(?:cgpa|c\.g\.p\.a|gpa|cpi|grade point)\b/i.test(t)) {
      for (const m of t.matchAll(/(?<![\d.])(10(?:\.0+)?|\d(?:\.\d{1,2})?)(?![\d.]*\s*%)(?!\s*(?:\/\s*10|out of 10))(?![\d])/g)) {
        const before = lower.slice(Math.max(0, m.index! - 45), m.index!); const after = lower.slice(m.index! + m[0].length, m.index! + m[0].length + 25); const near = lower.slice(Math.max(0, m.index! - 50), m.index! + m[0].length + 50);
        if (!/cgpa|gpa|cpi|grade point/.test(near)) continue;
        if (/\b(?:sem(?:ester)?|year|round|batch|class)\s*$/.test(before) || /^\s*(?:st|nd|rd|th|\s*(?:years?|rounds?|semesters?|members|openings))/.test(after)) continue;
        const maxy = /(?:below|less than|at most|maximum|up ?to|not more than|<)\s*(?:a |an |the )?(?:cgpa|gpa|cpi)?\s*(?:of |is |:)?\s*$/.test(before);
        const strict = /(?:above|more than|greater than|over|exceeding|>(?!=))\s*(?:a |an |the )?(?:cgpa|gpa|cpi)?\s*(?:of |is |:)?\s*$/.test(before) && !/or equal|and above|or above|\+|or more/.test(after);
        const minWord = /(?:minimum|min\.?|at least|not less than|atleast|≥|>=|required|should (?:have|be|score)|must (?:have|be))/.test(before) || /^\s*(?:and above|or above|or more|\+|and more)/.test(after) || /(?:cgpa|gpa|cpi)\s*[:–-]?\s*(?:of\s*)?$/.test(before);
        // "60% aggregate OR 6.5 CGPA" (either way round) is an alternative, not a CGPA minimum: leave it for staff.
        const alt = /(?:%|percent(?:age)?|aggregate|marks)[^.]{0,25}\bor\s*(?:a |an |the )?\s*$/.test(before) || /^\s*(?:cgpa|gpa|cpi)?[^.;]{0,25}\bor\s+(?:\w+\s+){0,3}\d{2,3}(?:\.\d+)?\s*(?:%|percent)/.test(after);
        if (alt) add(i, { key: "minCgpa", value: null, strength: "heuristic", forceStatus: "AMBIGUOUS", note: `The text offers a CGPA (${m[0]}) as an alternative to a percentage. Decide which rule applies.` });
        else if (maxy) add(i, { key: "minCgpa", value: null, strength: "heuristic", forceStatus: "AMBIGUOUS", note: `The text states an upper CGPA limit (${m[0]}), not a minimum. Check what is meant.` });
        else if (strict) add(i, { key: "minCgpa", value: Number(m[0]), strength: "heuristic", note: `Says “above ${m[0]}” (strictly greater). The platform’s minimum is inclusive: a student with exactly ${m[0]} would be eligible. Confirm.` });
        else add(i, { key: "minCgpa", value: Number(m[0]), strength: minWord ? "explicit" : "heuristic" });
        break;
      }
    }
    {
      const quals: [string, RegExp][] = [["minTenth", /\b(?:10th|tenth|sslc|x(?:th)?\b|matric(?:ulation)?|ssc)\b/gi], ["minTwelfth", /\b(?:12th|twelfth|hsc|xii|puc|higher secondary|intermediate)\b/gi], ["minDiploma", /\bdiploma\b/gi]];
      const pcts = [...t.matchAll(/(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|per ?cent|percent)/gi)];
      const done = new Set<string>();
      // "60% in 10th and 12th": one percentage that applies to every qualification in the list that follows it
      const qualSrc = quals.map(([, re]) => re.source).join("|");
      for (const g of t.matchAll(new RegExp(String.raw`(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|per ?cent|percent)\s*(?:or above|and above|or more|minimum|aggregate)?\s*(?:in|at|for|marks in)?\s*((?:${qualSrc})(?:\s*(?:,|and|&|\/)\s*(?:${qualSrc}))+)`, "gi"))) {
        for (const [key, re] of quals) if (new RegExp(re.source, "i").test(g[2]) && Number(g[1]) <= 100) { add(i, { key, value: Number(g[1]), strength: "explicit" }); done.add(key); }
      }
      for (const [key, re] of quals) {                                   // "70% in 10th" binds exactly; so does "12th: 65%"
        if (done.has(key)) continue;
        const before = t.match(new RegExp(String.raw`(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|per ?cent|percent)\s*(?:or above|and above|or more)?\s*(?:in|at|for|marks in)\s*(?:the\s*)?(?:${re.source})`, "i"));
        const after = t.match(new RegExp(String.raw`(?:${re.source})\W{0,6}(?:minimum|min\.?|at least|of|score)?\W{0,6}(\d{1,3}(?:\.\d{1,2})?)\s*(?:%|per ?cent|percent)`, "i"));
        const hit = before ? before[1] : after ? after[after.length - 1] : null;
        if (hit !== null && Number(hit) <= 100) { add(i, { key, value: Number(hit), strength: "explicit" }); done.add(key); }
      }
      for (const [key, re] of quals) {
        if (done.has(key)) continue;
        for (const q of t.matchAll(re)) {
          let best: RegExpMatchArray | null = null; let bd = 45;
          for (const p of pcts) { const d = p.index! >= q.index! ? p.index! - (q.index! + q[0].length) : q.index! - (p.index! + p[0].length); if (d < bd || (d === bd && best && p.index! > q.index!)) { bd = d; best = p; } }
          if (best && Number(best[1]) <= 100 && !/(?:cgpa|gpa)/i.test(t.slice(Math.min(best.index!, q.index!), Math.max(best.index!, q.index!)))) { add(i, { key, value: Number(best[1]), strength: "explicit" }); break; }
        }
      }
    }
    if (/backlog|arrear/i.test(t)) {
      for (const clause of t.split(/[,;]|\band\b|&|\bwith\b|\bbut\b|\bhowever\b/i)) {
        if (!/backlog|arrear/i.test(clause)) continue;
        const c = clause.toLowerCase();
        const hist = /history of|historical|\bever\b|throughout|during (?:the )?(?:entire |whole )?(?:course|degree|programme|program)|any time|till date|in the past|\bpast\b|including cleared/.test(c);
        const active = /\bactive\b|\bcurrent(?:ly)?\b|\bstanding\b|\bpending\b|\bongoing\b|as on date|at the time|presently/.test(c);
        const zero = /\b(?:no|nil|zero|without|0)\b[^.]{0,30}?(?:backlog|arrear)|\b(?:not have|should not have|must not have|should have no|cannot have|free of|free from)\b[^.]{0,25}?(?:backlog|arrear)|(?:backlog|arrear)s?[^.]{0,25}?\b(?:not allowed|not permitted|nil|zero|none|0)\b/.test(c);
        const n = c.match(/(?:up ?to|maximum(?: of)?|max\.?|at most|atmost|not more than|<=|≤|only)\s*(\d+)\s*(?:active |current |standing )?(?:backlog|arrear)/) ?? c.match(/(\d+)\s*(?:active |current |standing )?(?:backlogs?|arrears?)\s*(?:are |is )?(?:allowed|permitted|maximum|max)/);
        if (!zero && !n) continue;
        const value = zero ? 0 : Number(n![1]);
        const key = hist && !active ? "maxArrears" : active && !hist ? "maxBacklogs" : null;
        if (key) add(i, { key, value, strength: "explicit" });
        else add(i, { key: "maxBacklogs", value, strength: "heuristic", forceStatus: "AMBIGUOUS", note: hist && active ? "Mentions both active and historical arrears in one clause." : "Does not say whether only ACTIVE arrears count or also cleared (historical) ones. Choose." });
      }
    }
    if (/\b(?:batch|pass(?:ing)?[- ]?out|passouts?|graduat\w*|class of|year of passing|passing year|2\d{3})\b/i.test(t)) {
      const ys = new Set<number>();
      for (const m of t.matchAll(/(20\d{2})\s*[-–]\s*(20\d{2})\s*(?:batch|pass)/gi)) ys.add(Number(m[2]));
      for (const m of t.matchAll(/(?:batch(?:es)?|pass(?:ing)?[- ]?outs?|passed out|graduat\w*|class of|year of passing|passing year|pass out)[^.\n]{0,70}/gi)) for (const y of m[0].matchAll(/\b(20\d{2})\b(?!\s*[-–]\s*20\d{2})/g)) ys.add(Number(y[1]));
      for (const m of t.matchAll(/\b(20\d{2})(?:\s*(?:,|&|and|\/)\s*(20\d{2}))*\s*(?:batch(?:es)?|pass(?:ing)?[- ]?outs?)/gi)) for (const y of m[0].matchAll(/20\d{2}/g)) ys.add(Number(y[0]));
      if (ys.size) add(i, { key: "passingYears", value: [...ys].sort(), strength: "explicit" });
    }
    if (/eligib|degree|qualification|course|pursuing|students?|candidates?|graduat|open to|b\.?e\b|b\.?tech|m\.?tech|mca|mba/i.test(t)) {
      const degs: string[] = [];
      if (/\bB\.?\s?E\b\.?(?!\w)/.test(t)) degs.push("B.E."); if (/\bB\.?\s?Tech\b/i.test(t)) degs.push("B.Tech");
      if (/\bM\.?\s?E\b\.?(?!\w)/.test(t)) degs.push("M.E."); if (/\bM\.?\s?Tech\b/i.test(t)) degs.push("M.Tech");
      if (/\bMCA\b/.test(t)) degs.push("MCA"); if (/\bMBA\b/.test(t)) degs.push("MBA"); if (/\bB\.?\s?Sc\b/i.test(t)) degs.push("B.Sc"); if (/\bM\.?\s?Sc\b/i.test(t)) degs.push("M.Sc");
      if (degs.length) add(i, { key: "degrees", value: degs, strength: "explicit" });
    }
    {
      const cue = /eligib|branch|department|dept|stream|discipline|open to|candidates from|students from|courses?|pursuing|b\.?e\b|b\.?tech/i.test(t);
      const prefer = /prefer|desirable|ideal(?:ly)?|added advantage|bonus|priority|will be given preference/i.test(t);
      const esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const own = ctx.departments.flatMap((d) => [new RegExp(String.raw`(?<![A-Za-z0-9])${esc(d.code)}(?![A-Za-z0-9])`, d.code.length <= 3 ? "" : "i").test(t) ? d.code : null, d.name.length >= 5 && new RegExp(esc(d.name), "i").test(t) ? d.name : null]).filter((x): x is string => !!x);
      const ms = [...new Set([...mentionsIn(t), ...own])];
      if (cue && saysAllBranches(t) && !prefer) add(i, { key: "departments", value: ["*ALL*"], strength: "heuristic", note: "The text says all branches." });
      else if (ms.length && (cue || ms.length >= 2 || prefer)) add(i, { key: prefer ? "preferredDepartments" : "departments", value: ms, strength: prefer ? "heuristic" : "explicit" });
    }

    // ── dates ──
    const hits = findDates(t, ctx.now);
    const kws = DATE_KEYS.flatMap((d) => { const m = t.match(new RegExp(d.re.source, "i")); return m ? [{ key: d.key, at: m.index!, end: m.index! + m[0].length }] : []; });
    if (kws.length) {
      for (const [hi, h] of hits.entries()) {
        const time = findTime(t.slice(h.end, hits[hi + 1]?.index ?? t.length)) ?? findTime(t.slice(Math.max(0, h.index - 12), h.index));
        const before = kws.filter((k) => k.end <= h.index).sort((a, b) => b.end - a.end)[0] ?? kws.sort((a, b) => a.at - b.at)[0];
        const key = before.key; const hasTime = time !== null;
        const value = key === "deadline" ? `${h.date}T${time ?? "23:59"}` : hasTime ? `${h.date}T${time}` : h.date;
        const notes = [h.yearGuessed ? `The year was not written; ${h.date.slice(0, 4)} was assumed (next occurrence after today in India).` : "", key === "deadline" && !hasTime ? "No time was stated; 23:59 is only a suggestion." : ""].filter(Boolean).join(" ");
        add(i, { key, value, strength: notes ? "heuristic" : "explicit", note: notes || undefined });
      }
      if (!hits.length && RELATIVE.test(t)) { const k = kws[0]; add(i, { key: k.key, value: null, strength: "heuristic", forceStatus: "AMBIGUOUS", note: `A relative date (“${t.match(RELATIVE)![0]}”) cannot be resolved without a trusted send date. Enter the exact date.` }); }
    }

    // ── process, documents, conditions (verbatim sentences) ──
    const sentence = (key: string, re: RegExp) => { if (re.test(t)) { const max = FIELD_BY_KEY[key].max ?? 1000; add(i, { key, value: cap(t, max), strength: "explicit", note: t.length > max ? "Shortened to fit; check it." : undefined }); } };
    sentence("bond", /\b(?:bond|service agreement|service bond|service period|lock[- ]in|minimum (?:service|commitment)|agreement of \d)/i);
    sentence("trainingPeriod", /\b(?:training period|training of \d|probation|bootcamp|induction training|\d+\s*months? (?:of )?training|training for \d)/i);
    sentence("relocation", /\b(?:relocat|pan[- ]india|willing to travel|work from any location|transfer)/i);
    sentence("shifts", /\b(?:night shift|day shift|rotational shifts?|shift timings?|work timings?|working hours|\bshifts?\b)/i);
    sentence("joiningTimeline", /\b(?:date of joining|joining date|joining (?:timeline|time)|onboarding|expected to join|will join|start date|joining in)/i);
    if (/document|carry|bring|upload|submit|attach|required|mandatory/i.test(t)) {
      const docs: [RegExp, string][] = [[/\b(?:resume|cv|curriculum vitae)\b/i, "Resume"], [/\bphoto(?:graph)?s?\b/i, "Passport-size photograph"], [/\b(?:college |student )?id card\b|\bidentity card\b/i, "College ID card"], [/\baadhaar|\baadhar/i, "Aadhaar card"], [/\bmark ?sheets?\b|\btranscripts?\b|\bgrade cards?\b/i, "Marksheets"], [/\bcertificates?\b/i, "Certificates"], [/\bpan card\b/i, "PAN card"], [/\bpassport\b(?! size| photo)/i, "Passport"], [/\bcover letter\b/i, "Cover letter"], [/\bportfolio\b/i, "Portfolio"]];
      const found = docs.filter(([re]) => re.test(t)).map(([, n]) => n);
      if (found.length) add(i, { key: "documents", value: found, strength: "explicit" });
    }
    {
      const R: [RegExp, string][] = [[/\bpsychometric\b/i, "Psychometric test"], [/\baptitude\b/i, "Aptitude test"], [/\b(?:online|written) (?:test|assessment|exam)\b|\bonline assessment\b/i, "Online assessment"], [/\bcoding (?:test|round|assessment|challenge)\b/i, "Coding round"], [/\bgroup discussion\b|\bGD\b/, "Group discussion"], [/\bcase study\b/i, "Case study"], [/\btechnical (?:interview|round|discussion)s?\b|\btech interview\b/i, "Technical interview"], [/\bmanagerial (?:round|interview)\b/i, "Managerial round"], [/\bhr (?:interview|round|discussion)s?\b|\bhuman resources? (?:interview|round)\b/i, "HR interview"]];
      const found = R.flatMap(([re, name]) => { const m = t.match(re); return m ? [{ name, at: m.index! }] : []; }).sort((a, b) => a.at - b.at);
      if (found.length) add(i, { key: "rounds", value: found.map((f) => f.name), strength: "explicit" });
    }
    if (/(?:application|apply|register|registration)\s*(?:process|instructions|procedure|steps)|how to apply|interested (?:students|candidates)/i.test(t)) add(i, { key: "applicationInstructions", value: cap(t, 1500), strength: "heuristic" });
  });
  return { candidates: out, usedUnits: used, units };
}

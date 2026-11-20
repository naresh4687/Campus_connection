/**
 * Extraction evaluation harness. Runs every case in eval/dataset.ts through the real pipeline and scores the result against the hand-written expectations.
 *   npx tsx eval/run.ts --mode rules                                   (pattern layer only; no model)
 *   npx tsx eval/run.ts --mode local --url http://127.0.0.1:8081 --model <label> [--pid <llama-server pid>] [--out file.json]
 *   add --set extra | all to include the second dataset (eval/dataset-extra.ts)
 * Nothing here is estimated: every number comes from running the cases. Failures are listed so they can be checked by hand.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { isEmptyValue, type FieldResult } from "../src/lib/intake/catalog";
import { runExtraction } from "../src/server/ai/pipeline";
import { localProvider, type ExtractionProvider } from "../src/server/ai/providers";
import type { AiConfig } from "../src/server/config";
import { CASES, CORE, ELIGIBILITY, EVAL_DEPARTMENTS, EVAL_NOW, type Case } from "./dataset";
import { EXTRA_CASES } from "./dataset-extra";

const arg = (n: string) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const mode = arg("mode") ?? "rules"; const out = arg("out"); const pid = arg("pid");
const only = arg("only")?.split(",");
const set = arg("set") ?? "original";                                  // original (35 cases) | extra (the second set) | all

const alnum = (s: string) => s.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const same = (a: unknown, b: unknown): boolean => {
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && [...a].map(String).sort().join("|") === [...b].map(String).sort().join("|");
  if (typeof a === "number" || typeof b === "number") return Number(a) === Number(b);
  return alnum(String(a)) === alnum(String(b));
};
const lenient = (a: unknown, b: unknown) => same(a, b) || (typeof a === "string" && typeof b === "string" && (alnum(a).includes(alnum(b)) || alnum(b).includes(alnum(a))));
const proposed = (f: FieldResult | undefined) => !!f && (f.status === "EXTRACTED" || f.status === "NEEDS_REVIEW") && !isEmptyValue(f.value);

type Row = { id: string; key: string; outcome: string; expected?: unknown; got?: unknown; status?: string };
async function main() {
  let provider: ExtractionProvider | null = null;
  if (mode === "local") {
    const c: AiConfig = { enabled: true, provider: "local", model: arg("model") ?? "local", base: (arg("url") ?? "http://127.0.0.1:8081").replace(/\/+$/, ""), apiKey: "", timeoutMs: Number(arg("timeout") ?? 180000) };
    provider = localProvider(c);
  }
  const pool = set === "extra" ? EXTRA_CASES : set === "all" ? [...CASES, ...EXTRA_CASES] : CASES;
  const cases = pool.filter((c) => !only || only.includes(c.id));
  const rows: Row[] = []; const latencies: number[] = []; const perCase: { id: string; ms: number; modelRan: boolean; problem: string | null }[] = [];
  let tp = 0, fp = 0, fn = 0, exactOk = 0, exactTotal = 0, lenientOk = 0, textTotal = 0;
  let eligExpected = 0, eligCorrect = 0, eligWrongProposed = 0, eligSettledWrong = 0, eligInvented = 0, eligSettledInvented = 0;
  let missExpected = 0, missOk = 0, invented = 0, contraExpected = 0, contraOk = 0, contraSilent = 0, falseContra = 0, ambExpected = 0, ambOk = 0, modelRuns = 0, modelValid = 0, injectionCases = 0, injectionFlagged = 0, injectionLeaks = 0;
  for (const c of cases) {
    const r = await runExtraction(c.text, { now: EVAL_NOW, departments: EVAL_DEPARTMENTS }, provider);
    perCase.push({ id: c.id, ms: r.ms, modelRan: r.modelRan, problem: r.modelProblem });
    if (provider) { modelRuns++; if (r.modelRan) { modelValid++; latencies.push(r.ms); } }
    const f = r.extraction.fields;
    for (const key of CORE) {
      const exp = c.expected[key]; const got = f[key]; const isElig = (ELIGIBILITY as readonly string[]).includes(key);
      const contra = c.contradictory?.includes(key); const amb = c.ambiguous?.includes(key);
      if (contra) { contraExpected++; if (got?.status === "CONTRADICTORY") contraOk++; else { rows.push({ id: c.id, key, outcome: "contradiction missed", status: got?.status, got: got?.value }); if (got?.status === "EXTRACTED") contraSilent++; } continue; }
      if (amb) { ambExpected++; if (got?.status !== "EXTRACTED") ambOk++; else rows.push({ id: c.id, key, outcome: "ambiguous value accepted as clean", got: got.value }); if (isElig && proposed(got)) eligInvented += got?.status === "EXTRACTED" ? 0 : 0; continue; }
      if (exp === undefined) {
        missExpected++;
        if (proposed(got)) { invented++; fp++; rows.push({ id: c.id, key, outcome: "INVENTED value", got: got.value, status: got.status }); if (isElig) { eligInvented++; if (got.status === "EXTRACTED") eligSettledInvented++; } } else missOk++;
        if (got?.status === "CONTRADICTORY") falseContra++;
        continue;
      }
      exactTotal++; if (isElig) eligExpected++;
      if (typeof exp === "string" && !["employmentType", "ctcKind", "workMode", "deadline", "preplacementTalk", "registrationLink", "contactEmail", "contactPhone", "trainingSalary", "postTrainingSalary"].includes(key)) { textTotal++; if (proposed(got) && lenient(got.value, exp)) lenientOk++; }
      if (proposed(got) && same(got.value, exp)) { tp++; exactOk++; if (isElig) eligCorrect++; }
      else if (proposed(got)) { fp++; fn++; rows.push({ id: c.id, key, outcome: "WRONG value", expected: exp, got: got.value, status: got.status }); if (isElig) { eligWrongProposed++; if (got.status === "EXTRACTED") eligSettledWrong++; } }
      else { fn++; rows.push({ id: c.id, key, outcome: "not found", expected: exp, status: got?.status }); }
    }
    if (c.injection) { injectionCases++; if (r.extraction.warnings.some((w) => w.kind === "INJECTION")) injectionFlagged++; if (ELIGIBILITY.some((k) => (k === "minCgpa" ? f[k]?.value === 0 : false) || (k === "departments" && proposed(f[k]) && (f[k].value as string[]).length === EVAL_DEPARTMENTS.length && !c.expected[k]))) injectionLeaks++; }
  }
  const p = tp / Math.max(1, tp + fp), rc = tp / Math.max(1, tp + fn);
  const ram = pid ? Number((readFileSync(`/proc/${pid}/status`, "utf8").match(/VmHWM:\s+(\d+)/)?.[1] ?? 0)) / 1024 : null;
  const sorted = [...latencies].sort((a, b) => a - b);
  const summary = {
    mode, model: arg("model") ?? (mode === "rules" ? "patterns only" : "?"), cases: cases.length, scoredFields: exactTotal, "precision": +p.toFixed(3), "recall": +rc.toFixed(3), "f1": +(2 * p * rc / Math.max(1e-9, p + rc)).toFixed(3),
    exactMatchAccuracy: +(exactOk / Math.max(1, exactTotal)).toFixed(3), textFieldsLenientMatch: `${lenientOk}/${textTotal}`,
    eligibility: { expected: eligExpected, correct: eligCorrect, accuracy: +(eligCorrect / Math.max(1, eligExpected)).toFixed(3), wrongValueProposed: eligWrongProposed, inventedValueProposed: eligInvented, "wrongOrInvented_andCleanlyEXTRACTED(no human check would be forced)": eligSettledWrong + eligSettledInvented },
    missingFieldDetection: `${missOk}/${missExpected}`, inventedValues: invented, contradictionDetection: `${contraOk}/${contraExpected}`, contradictionSilentlyChosen: contraSilent, falseContradictionFlags: falseContra,
    ambiguousNotAcceptedAsClean: `${ambOk}/${ambExpected}`, injection: { cases: injectionCases, flagged: injectionFlagged, eligibilityLeaks: injectionLeaks },
    modelOutputValid: provider ? `${modelValid}/${modelRuns}` : "n/a",
    latencyMs: provider && sorted.length ? { mean: Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length), median: sorted[Math.floor(sorted.length / 2)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))], max: sorted[sorted.length - 1] } : "n/a (patterns run in microseconds)",
    serverPeakRamMB: ram === null ? "not measured" : Math.round(ram),
  };
  console.log(JSON.stringify(summary, null, 2));
  if (out) writeFileSync(out, JSON.stringify({ summary, failures: rows, perCase }, null, 2));
  if (process.argv.includes("--failures")) for (const r of rows) console.log(`${r.id.padEnd(26)} ${r.key.padEnd(18)} ${r.outcome.padEnd(30)} exp=${JSON.stringify(r.expected)} got=${JSON.stringify(r.got)} [${r.status ?? ""}]`);
}
void main();
void (null as unknown as Case);

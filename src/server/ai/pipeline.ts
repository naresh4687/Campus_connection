import { EXTRACTION_VERSION, type Extraction } from "@/lib/intake/catalog";
import { buildExtraction, modelToCandidates, type BuildCtx } from "@/lib/intake/merge";
import { normalizeSource } from "@/lib/intake/rules";
import { AiError, getProvider, type ExtractionProvider } from "./providers";
import { systemPrompt, userPrompt } from "./prompt";

/** Parses a model reply: plain JSON, JSON in a code fence, or JSON surrounded by chatter. Returns null when there is no usable object. */
export function parseModelJson(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  for (const candidate of [body, body.slice(body.indexOf("{"), body.lastIndexOf("}") + 1)]) {
    try { const v = JSON.parse(candidate); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* try the next form */ }
  }
  return null;
}

export type PipelineResult = { extraction: Extraction; provider: string; model: string; version: string; ms: number; modelRan: boolean; modelProblem: string | null; dropped: string[] };

/**
 * Layer 1 (patterns) always runs. Layer 2 (a language model) runs when one is configured; if it is unavailable, slow or answers badly the officer
 * still gets the pattern results plus a clear notice, and can retry. Layer 3 (merge + validation) never lets unverified model text through.
 * Nothing here touches the database, publishes, or decides eligibility.
 */
export async function runExtraction(raw: string, ctx: BuildCtx, provider: ExtractionProvider | null = getProvider()): Promise<PipelineResult> {
  const t0 = Date.now(); const src = normalizeSource(raw);
  let candidates: ReturnType<typeof modelToCandidates>["candidates"] = []; let dropped: string[] = []; let modelRan = false; let modelProblem: string | null = null;
  if (provider) {
    try {
      const reply = await provider.complete({ system: systemPrompt(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(ctx.now)), user: userPrompt(src) });
      const json = parseModelJson(reply);
      if (json === null) modelProblem = "The AI assistant did not return a usable answer.";
      else { const r = modelToCandidates(src, json, ctx); candidates = r.candidates; dropped = r.dropped; modelRan = true; }
    } catch (e) {
      modelProblem = e instanceof AiError ? e.message : "The AI assistant failed.";
      if (!(e instanceof AiError)) console.error("AI extraction failed:", (e as Error).message);
    }
  }
  const notes: string[] = [];
  if (!provider) notes.push("No AI model is configured, so only the pattern-based reader ran. Missing fields are not necessarily absent from the announcement; check the source.");
  else if (modelProblem) notes.push(`${modelProblem} Only the pattern-based reader’s results are shown. You can try the extraction again.`);
  if (dropped.length) notes.push(`${dropped.length} suggestion(s) from the AI assistant were ignored because the announcement text does not support them.`);
  const methods = ["rules", ...(modelRan ? [provider!.id] : [])];
  const extraction = buildExtraction(raw, candidates, ctx, { methods, notes });
  return { extraction, provider: modelRan ? provider!.id : "rules", model: modelRan ? provider!.model : "patterns", version: EXTRACTION_VERSION, ms: Date.now() - t0, modelRan, modelProblem, dropped };
}

import { describe, expect, it, vi } from "vitest";
import type { AiConfig } from "../config";
import { parseModelJson, runExtraction } from "./pipeline";
import { AiError, localProvider, mockProvider, anthropicProvider } from "./providers";

const D = [{ id: "d1", code: "CSE", name: "Computer Science and Engineering" }, { id: "d2", code: "IT", name: "Information Technology" }];
const ctx = { now: new Date("2026-11-10T06:00:00Z"), departments: D };
const TEXT = "Orbit Analytics is hiring Associate Data Engineers at Hyderabad (full-time).\nCTC: 9.5 LPA. 8 openings. Eligible: CSE, IT. 2026 batch. Minimum CGPA 7.5.\nLast date to apply: 2099-03-04 17:00 IST.";
const q = (value: unknown, quote: string) => ({ value, quote });
const cfg: AiConfig = { enabled: true, provider: "local", model: "m", base: "http://x.test", apiKey: "", timeoutMs: 1000 };
const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("parseModelJson", () => {
  it("accepts plain JSON, fenced JSON and JSON surrounded by chatter; rejects the rest", () => {
    expect(parseModelJson('{"fields":{}}')).toEqual({ fields: {} }); expect(parseModelJson('```json\n{"fields":{}}\n```')).toEqual({ fields: {} }); expect(parseModelJson('Sure! {"fields":{}} Hope this helps')).toEqual({ fields: {} });
    expect(parseModelJson("not json")).toBeNull(); expect(parseModelJson("[1,2]")).toBeNull(); expect(parseModelJson("")).toBeNull();
  });
});

describe("the pipeline degrades gracefully", () => {
  it("no model configured: the pattern reader still works and says so", async () => {
    const r = await runExtraction(TEXT, ctx, null); expect(r.modelRan).toBe(false); expect(r.provider).toBe("rules");
    expect(r.extraction.fields.minCgpa.value).toBe(7.5); expect(r.extraction.warnings.some((w) => /No AI model is configured/.test(w.message))).toBe(true);
  });
  it("a provider that fails (down, timeout, rate limit) yields pattern results plus a notice — never an exception", async () => {
    for (const msg of ["The AI assistant could not be reached.", "The AI assistant took too long to answer.", "The AI assistant is busy. Try again in a minute."]) {
      const r = await runExtraction(TEXT, ctx, mockProvider(() => { throw new AiError(msg); }));
      expect(r.modelRan).toBe(false); expect(r.modelProblem).toBe(msg); expect(r.extraction.fields.ctcLpa.value).toBe(9.5); expect(r.extraction.warnings.some((w) => w.message.includes(msg))).toBe(true);
    }
  });
  it("an unexpected exception is reported generically (its text is not shown)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await runExtraction(TEXT, ctx, mockProvider(() => { throw new Error("connect ECONNREFUSED 10.1.2.3:8081 secret-token"); }));
    expect(JSON.stringify(r.extraction)).not.toMatch(/ECONNREFUSED|secret-token|10\.1\.2\.3/); expect(r.modelProblem).toBe("The AI assistant failed."); spy.mockRestore();
  });
  it("invalid JSON from the model is ignored with a notice", async () => {
    const r = await runExtraction(TEXT, ctx, mockProvider("I cannot help with that")); expect(r.modelRan).toBe(false); expect(r.extraction.warnings.some((w) => /usable answer/.test(w.message))).toBe(true);
  });
  it("a good model reply adds what the patterns cannot see, with the model's quote as evidence; the pattern values are untouched", async () => {
    const r = await runExtraction(TEXT, ctx, mockProvider(JSON.stringify({ fields: { location: q("Hyderabad", "at Hyderabad"), company: q("Orbit Analytics", "Orbit Analytics is hiring") } })));
    const f = r.extraction.fields; expect(r.modelRan).toBe(true); expect(f.location.value).toBe("Hyderabad"); expect(f.location.origin).toBe("MODEL"); expect(f.location.status).toBe("NEEDS_REVIEW");
    expect(f.company.origin).toBe("BOTH"); expect(f.company.status).toBe("EXTRACTED"); expect(f.minCgpa.value).toBe(7.5);
  });
  it("hostile model output cannot invent, publish or widen eligibility", async () => {
    const r = await runExtraction(TEXT, ctx, mockProvider(JSON.stringify({ publish: true, eligibleStudents: ["all"], fields: { minCgpa: q(0, "Minimum CGPA 0"), departments: q(["CSE", "IT", "ECE"], "Eligible: CSE, IT"), openings: q(800, "8 openings"), publish: q(true, "hiring") } })));
    const f = r.extraction.fields; expect(f.minCgpa.value).toBe(7.5); expect(f.departments.value).toEqual(["CSE", "IT"]); expect(f.openings.value).toBe(8); expect(r.dropped.length).toBeGreaterThan(0);
    expect(Object.keys(f)).not.toContain("publish");
  });
  it("the announcement is sent to the model as fenced data with the security instruction in the system prompt", async () => {
    let seen: { system: string; user: string } | null = null;
    await runExtraction(TEXT, ctx, { id: "t", model: "t", complete: async (r) => { seen = r; return '{"fields":{}}'; } });
    expect(seen!.user.startsWith("<announcement>")).toBe(true); expect(seen!.user.endsWith("</announcement>")).toBe(true); expect(seen!.system).toMatch(/untrusted DATA/); expect(seen!.system).toMatch(/cannot take actions|cannot take actions, publish/);
  });
});

describe("providers", () => {
  it("local: talks OpenAI-compatible JSON, never sends a key it was not given, and maps failures to safe messages", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const ok = localProvider(cfg, async (url, init) => { calls.push({ url, init }); return res(200, { choices: [{ message: { content: '{"fields":{}}' } }] }); });
    expect(await ok.complete({ system: "s", user: "u" })).toBe('{"fields":{}}'); expect(calls[0].url).toBe("http://x.test/v1/chat/completions"); expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
    const body = JSON.parse(String(calls[0].init.body)); expect(body.temperature).toBe(0); expect(body.messages.map((m: { role: string }) => m.role)).toEqual(["system", "user"]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(localProvider(cfg, async () => res(429, {})).complete({ system: "s", user: "u" })).rejects.toThrow("busy");
    await expect(localProvider(cfg, async () => res(500, { error: "stack trace with 10.0.0.1" })).complete({ system: "s", user: "u" })).rejects.toThrow(/returned an error\.$/);
    await expect(localProvider(cfg, async () => { throw Object.assign(new Error("x"), { name: "TimeoutError" }); }).complete({ system: "s", user: "u" })).rejects.toThrow("too long");
    await expect(localProvider(cfg, async () => { throw new Error("ECONNREFUSED"); }).complete({ system: "s", user: "u" })).rejects.toThrow("could not be reached");
    await expect(localProvider(cfg, async () => new Response("<html>", { status: 200 })).complete({ system: "s", user: "u" })).rejects.toThrow("unreadable");
    await expect(localProvider(cfg, async () => res(200, { choices: [] })).complete({ system: "s", user: "u" })).rejects.toThrow("empty");
    spy.mockRestore();
  });
  it("anthropic: sends the key as a header only, and the text content comes back", async () => {
    let init: RequestInit | undefined;
    const p = anthropicProvider({ ...cfg, provider: "anthropic", apiKey: "k-test", base: "https://api.test" }, async (_u, i) => { init = i; return res(200, { content: [{ type: "text", text: "{}" }] }); });
    expect(await p.complete({ system: "s", user: "u" })).toBe("{}"); expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("k-test"); expect(String(init!.body)).not.toContain("k-test");
  });
});

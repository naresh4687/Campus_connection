import { aiConfig, type AiConfig } from "../config";

/** The only thing the drive-creation code knows about a model: text in, text out. Swap the implementation through configuration. */
export type ModelRequest = { system: string; user: string };
export interface ExtractionProvider { id: string; model: string; complete(req: ModelRequest): Promise<string> }
export class AiError extends Error {}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

async function post(fetchImpl: FetchLike, url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new AiError((e as Error).name === "TimeoutError" ? "The AI assistant took too long to answer." : "The AI assistant could not be reached.");
  }
  if (!res.ok) {
    console.error("AI provider request failed with status", res.status);       // never the body: it may echo the announcement
    throw new AiError(res.status === 429 ? "The AI assistant is busy. Try again in a minute." : "The AI assistant returned an error.");
  }
  try { return await res.json(); } catch { throw new AiError("The AI assistant returned an unreadable answer."); }
}

/** A local or self-hosted model behind an OpenAI-compatible endpoint (llama.cpp's llama-server, Ollama, vLLM). No key leaves the machine. */
export function localProvider(c: AiConfig, fetchImpl: FetchLike = fetch): ExtractionProvider {
  return {
    id: "local", model: c.model,
    async complete({ system, user }) {
      const body = await post(fetchImpl, `${c.base}/v1/chat/completions`, c.apiKey ? { authorization: `Bearer ${c.apiKey}` } : {},
        { model: c.model, temperature: 0, max_tokens: 1800, response_format: { type: "json_object" }, messages: [{ role: "system", content: system }, { role: "user", content: user }] }, c.timeoutMs) as { choices?: { message?: { content?: string } }[] };
      const out = body.choices?.[0]?.message?.content;
      if (!out) throw new AiError("The AI assistant returned an empty answer.");
      return out;
    },
  };
}

export function anthropicProvider(c: AiConfig, fetchImpl: FetchLike = fetch): ExtractionProvider {
  return {
    id: "anthropic", model: c.model,
    async complete({ system, user }) {
      const body = await post(fetchImpl, `${c.base}/v1/messages`, { "x-api-key": c.apiKey, "anthropic-version": "2023-06-01" }, { model: c.model, max_tokens: 2500, temperature: 0, system, messages: [{ role: "user", content: user }] }, c.timeoutMs) as { content?: { type: string; text?: string }[] };
      const out = body.content?.find((b) => b.type === "text")?.text;
      if (!out) throw new AiError("The AI assistant returned an empty answer.");
      return out;
    },
  };
}

/** Test provider: returns a fixed reply (default: nothing found, so only the pattern layer contributes). */
export function mockProvider(reply: string | (() => string | Promise<string>) = '{"fields":{}}'): ExtractionProvider {
  return { id: "mock", model: "mock", complete: async () => (typeof reply === "function" ? reply() : reply) };
}

let override: ExtractionProvider | null | undefined;
/** Tests only. */
export function setProviderForTests(p: ExtractionProvider | null | undefined) { override = p; }

/** The configured provider, or null when no model is configured (drive creation still works: the pattern layer needs no model). */
export function getProvider(fetchImpl?: FetchLike): ExtractionProvider | null {
  if (override !== undefined) return override;
  const c = aiConfig();
  if (!c.enabled) return null;
  if (c.provider === "local") return localProvider(c, fetchImpl);
  if (c.provider === "anthropic") return anthropicProvider(c, fetchImpl);
  if (c.provider === "mock") return mockProvider();
  return null;
}

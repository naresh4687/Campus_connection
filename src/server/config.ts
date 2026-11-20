import { z } from "zod";

const schema = z.object({
  /**
   * The app's database connection. Use APP_DATABASE_URL where a platform manages DATABASE_URL for you (for example the Vercel + Neon integration,
   * which fills it with the database OWNER'S login). APP_DATABASE_URL wins when both are set. Either way, in production the login must be cc_app.
   */
  DATABASE_URL: z.string().min(1).optional(),
  APP_DATABASE_URL: z.string().min(1).optional(),
  AUTH_PEPPER: z.string().min(32, "AUTH_PEPPER must be at least 32 characters"),
  AUTH_COOKIE_SECURE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** Public origin used to build one-time links (invitations/resets), e.g. https://app.example.com. Never derived from request headers in production. */
  APP_BASE_URL: z.url().optional(),
  // Private object storage (S3-compatible). Required for documents; validated when first used (see storageConfig()).
  S3_ENDPOINT: z.url().optional(),
  /** Origin browsers can reach, used when SIGNING download links. Defaults to S3_ENDPOINT. */
  S3_PUBLIC_ENDPOINT: z.url().optional(),
  S3_REGION: z.string().min(1).default("us-east-1"),
  S3_BUCKET: z.string().min(3).optional(),
  S3_ACCESS_KEY: z.string().min(1).optional(),
  S3_SECRET_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
});

/** The user name inside a connection string, or "" if it cannot be read. */
function databaseLogin(url: string): string {
  try { return decodeURIComponent(new URL(url).username); } catch { return ""; }
}

let cached: (Omit<z.infer<typeof schema>, "DATABASE_URL"> & { DATABASE_URL: string }) | undefined;

/** Server-only configuration. Throws a clear error if required variables are missing or unsafe. */
export function config() {
  if (!cached) {
    const raw = schema.parse(process.env);
    const databaseUrl = raw.APP_DATABASE_URL ?? raw.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL (or APP_DATABASE_URL) must be set");
    const c = { ...raw, DATABASE_URL: databaseUrl };
    if (process.env.NODE_ENV === "production") {
      // Row-level security is what keeps one college's data from another's, and it only applies to the restricted runtime role.
      // The owner/admin role bypasses it, so refuse to start rather than quietly run without isolation.
      if (databaseLogin(databaseUrl) !== "cc_app") throw new Error("The app must connect to the database as the restricted cc_app role (set APP_DATABASE_URL or DATABASE_URL accordingly), never the owner or admin role");
      // The only escape hatch exists so the browser test suite can run a production build over plain http://127.0.0.1.
      // The value is deliberately awkward; it must never appear in a real deployment's environment.
      const e2eOverride = process.env.AUTH_ALLOW_INSECURE_COOKIES === "e2e-test-server-only";
      if (!c.AUTH_COOKIE_SECURE && !e2eOverride) throw new Error("AUTH_COOKIE_SECURE must be true in production");
      if (!c.APP_BASE_URL) throw new Error("APP_BASE_URL must be set in production (used to build invitation links)");
      if (/dev-only|change-me/i.test(c.AUTH_PEPPER)) throw new Error("AUTH_PEPPER is a development value; set a real secret in production");
    }
    cached = c;
  }
  return cached;
}

/** Storage settings, or a clear error naming what is missing. Called only by code that actually touches storage. */
export function storageConfig() {
  const c = config();
  const missing = (["S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY", "S3_SECRET_KEY"] as const).filter((k) => !c[k]);
  if (missing.length) throw new Error(`Private document storage is not configured (missing ${missing.join(", ")})`);
  const e2eOverride = process.env.AUTH_ALLOW_INSECURE_COOKIES === "e2e-test-server-only";   // the browser-test server uses the local dev store
  if (process.env.NODE_ENV === "production" && !e2eOverride && /dev_storage/.test(c.S3_SECRET_KEY!)) throw new Error("S3_SECRET_KEY is a development value; set real storage credentials in production");
  return {
    endpoint: c.S3_ENDPOINT!, publicEndpoint: c.S3_PUBLIC_ENDPOINT ?? c.S3_ENDPOINT!, region: c.S3_REGION, bucket: c.S3_BUCKET!,
    accessKey: c.S3_ACCESS_KEY!, secretKey: c.S3_SECRET_KEY!, forcePathStyle: c.S3_FORCE_PATH_STYLE,
  };
}

export type AiConfig = { enabled: boolean; provider: "off" | "local" | "anthropic" | "mock"; model: string; base: string; apiKey: string; timeoutMs: number };
/**
 * AI-assisted drive creation. The pattern-based reader needs no model and is always available; this only controls the optional language model.
 * AI_PROVIDER = local (llama.cpp / Ollama / vLLM, OpenAI-compatible, AI_LOCAL_URL) | anthropic (ANTHROPIC_API_KEY) | mock | off.
 * Off unless AI_EXTRACTION_ENABLED=true. Base URLs are operator configuration, never user input.
 */
export function aiConfig(): AiConfig {
  const on = process.env.AI_EXTRACTION_ENABLED === "true";
  const requested = (process.env.AI_PROVIDER || (process.env.ANTHROPIC_API_KEY ? "anthropic" : "off")).toLowerCase();
  const provider = (["local", "anthropic", "mock"].includes(requested) ? requested : "off") as AiConfig["provider"];
  const timeoutMs = Math.min(Math.max(Number(process.env.AI_TIMEOUT_MS) || (provider === "local" ? 90_000 : 30_000), 1000), 300_000);
  if (provider === "local") return { enabled: on && !!process.env.AI_LOCAL_URL, provider, model: process.env.AI_MODEL || "local", base: (process.env.AI_LOCAL_URL ?? "").replace(/\/+$/, ""), apiKey: process.env.AI_LOCAL_KEY ?? "", timeoutMs };
  if (provider === "anthropic") return { enabled: on && !!process.env.ANTHROPIC_API_KEY, provider, model: process.env.AI_MODEL || "claude-sonnet-5-5", base: (process.env.AI_API_BASE || "https://api.anthropic.com").replace(/\/+$/, ""), apiKey: process.env.ANTHROPIC_API_KEY ?? "", timeoutMs };
  return { enabled: on && provider === "mock", provider, model: provider, base: "", apiKey: "", timeoutMs };
}

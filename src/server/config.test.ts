import { afterEach, describe, expect, it, vi } from "vitest";

const base = { DATABASE_URL: "postgresql://cc_app:pw@db.test/app", AUTH_PEPPER: "p".repeat(40), APP_BASE_URL: "https://app.example.test" };
afterEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });

async function load(env: Record<string, string | undefined>) {
  for (const k of ["DATABASE_URL", "AUTH_PEPPER", "AUTH_COOKIE_SECURE", "TRUSTED_PROXY_HOPS", "APP_BASE_URL"]) vi.stubEnv(k, env[k] as string);
  return (await import("./config")).config();
}

describe("config", () => {
  it("rejects a short pepper", async () => {
    await expect(load({ ...base, AUTH_PEPPER: "short" })).rejects.toThrow();
  });
  it("defaults cookies to Secure and proxies to 0", async () => {
    const c = await load(base);
    expect(c.AUTH_COOKIE_SECURE).toBe(true);
    expect(c.TRUSTED_PROXY_HOPS).toBe(0);
  });
  it("allows insecure cookies in production only with the explicit e2e override", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_ALLOW_INSECURE_COOKIES", "e2e-test-server-only");
    expect((await load({ ...base, AUTH_COOKIE_SECURE: "false" })).AUTH_COOKIE_SECURE).toBe(false);
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_ALLOW_INSECURE_COOKIES", "true"); // any other value is ignored
    await expect(load({ ...base, AUTH_COOKIE_SECURE: "false" })).rejects.toThrow(/AUTH_COOKIE_SECURE/);
  });
  it("requires APP_BASE_URL in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(load({ ...base, APP_BASE_URL: undefined })).rejects.toThrow(/APP_BASE_URL/);
  });
  it("refuses insecure cookies or the dev pepper in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(load({ ...base, AUTH_COOKIE_SECURE: "false" })).rejects.toThrow(/AUTH_COOKIE_SECURE/);
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production");
    await expect(load({ ...base, AUTH_PEPPER: "dev-only-pepper-change-me-0123456789abcdef" })).rejects.toThrow(/AUTH_PEPPER/);
  });
  it("refuses development storage credentials in production, except for the e2e test server", async () => {
    const storage = { S3_ENDPOINT: "http://store.test", S3_BUCKET: "bucket-x", S3_ACCESS_KEY: "a", S3_SECRET_KEY: "dev_storage_secret_key" };
    const run = async (extra: Record<string, string>) => {
      for (const [k, v] of Object.entries({ ...storage, ...extra })) vi.stubEnv(k, v);
      const { storageConfig } = await import("./config");
      return storageConfig();
    };
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUTH_COOKIE_SECURE", "true"); vi.stubEnv("DATABASE_URL", "postgresql://cc_app:pw@db.test/app"); vi.stubEnv("AUTH_PEPPER", "p".repeat(40)); vi.stubEnv("APP_BASE_URL", "https://a.test");
    await expect(run({})).rejects.toThrow(/development value/);
    vi.resetModules();
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUTH_COOKIE_SECURE", "false"); vi.stubEnv("AUTH_ALLOW_INSECURE_COOKIES", "e2e-test-server-only"); vi.stubEnv("DATABASE_URL", "postgresql://cc_app:pw@db.test/app"); vi.stubEnv("AUTH_PEPPER", "p".repeat(40)); vi.stubEnv("APP_BASE_URL", "https://a.test");
    await expect(run({})).resolves.toMatchObject({ bucket: "bucket-x" });
  });
  it("reports exactly which storage settings are missing", async () => {
    for (const [k, v] of Object.entries({ DATABASE_URL: "postgresql://x", AUTH_PEPPER: "p".repeat(40), S3_ENDPOINT: "", S3_BUCKET: "", S3_ACCESS_KEY: "", S3_SECRET_KEY: "" })) vi.stubEnv(k, v);
    vi.stubEnv("S3_ENDPOINT", undefined as unknown as string); vi.stubEnv("S3_BUCKET", undefined as unknown as string); vi.stubEnv("S3_ACCESS_KEY", undefined as unknown as string); vi.stubEnv("S3_SECRET_KEY", undefined as unknown as string);
    const { storageConfig } = await import("./config");
    expect(() => storageConfig()).toThrow(/missing S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY/);
  });
});

describe("database login", () => {
  const prod = (env: Record<string, string>) => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUTH_COOKIE_SECURE", "true"); vi.stubEnv("AUTH_PEPPER", "p".repeat(40)); vi.stubEnv("APP_BASE_URL", "https://a.test");
    for (const k of ["DATABASE_URL", "APP_DATABASE_URL"]) vi.stubEnv(k, undefined as unknown as string);
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    return import("./config").then((m) => m.config());
  };
  it("in production refuses any login other than cc_app, so an owner or admin connection can never run the app", async () => {
    await expect(prod({ DATABASE_URL: "postgresql://neondb_owner:pw@db.test/neondb" })).rejects.toThrow(/cc_app/);
    vi.resetModules();
    await expect(prod({ DATABASE_URL: "postgresql://cc_owner:pw@db.test/neondb" })).rejects.toThrow(/cc_app/);
    vi.resetModules();
    await expect(prod({ DATABASE_URL: "not a url" })).rejects.toThrow(/cc_app/);
    vi.resetModules();
    await expect(prod({ DATABASE_URL: "postgresql://cc_app:p%40ss@db.test/neondb" })).resolves.toMatchObject({ DATABASE_URL: "postgresql://cc_app:p%40ss@db.test/neondb" });
  });
  it("APP_DATABASE_URL wins over a platform-managed DATABASE_URL, and the managed owner login is then never used", async () => {
    const c = await prod({ DATABASE_URL: "postgresql://neondb_owner:pw@db.test/neondb", APP_DATABASE_URL: "postgresql://cc_app:pw@pooler.test/neondb" });
    expect(c.DATABASE_URL).toBe("postgresql://cc_app:pw@pooler.test/neondb");
  });
  it("needs at least one of the two", async () => {
    await expect(prod({})).rejects.toThrow(/DATABASE_URL/);
  });
});

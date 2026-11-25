import "dotenv/config";

process.env.S3_BUCKET = "campusconnect-e2e"; // workers and the test server use their own bucket
import { defineConfig, devices } from "@playwright/test";
import { generateVAPIDKeys } from "web-push";

// Throw-away VAPID keys for the test server only (generated fresh each run; never real credentials).
const vapid = generateVAPIDKeys();

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1, // specs share one seeded database and per-account rate limits
  reporter: "list",
  use: { baseURL: "http://127.0.0.1:3100" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command:
      "npm run build && cp -r .next/static .next/standalone/.next/ && cp -r public .next/standalone/ && PORT=3100 HOSTNAME=127.0.0.1 node .next/standalone/server.js",
    url: "http://127.0.0.1:3100/api/health",
    timeout: 240_000,
    reuseExistingServer: false,
    // The browser tests run against the *_test database (rebuilt and seeded with synthetic data by global-setup).
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? "",
      AUTH_PEPPER: "e2e-pepper-0123456789abcdef0123456789abcdef",
      AUTH_COOKIE_SECURE: "false",
      AUTH_ALLOW_INSECURE_COOKIES: "e2e-test-server-only",
      // Seeded administrators have no authenticator app; accounts that do enrol are still asked for a code.
      TWO_STEP_SIGN_IN: "on",
      AUTH_MFA_ENFORCEMENT: "off-e2e-test-server-only",
      APP_BASE_URL: "http://127.0.0.1:3100",
      S3_ENDPOINT: process.env.S3_ENDPOINT ?? "",
      S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT ?? "",
      S3_BUCKET: "campusconnect-e2e",
      S3_ACCESS_KEY: process.env.S3_ACCESS_KEY ?? "",
      S3_SECRET_KEY: process.env.S3_SECRET_KEY ?? "",
      VAPID_PUBLIC_KEY: vapid.publicKey, VAPID_PRIVATE_KEY: vapid.privateKey, VAPID_SUBJECT: "mailto:e2e@example.test",
      PUSH_WORKER_SECRET: "e2e-push-worker-secret-0123456789abcdef",
      TRUSTED_PROXY_HOPS: "0",
      // Turns on the deliberate-crash pages used by e2e/error-pages.spec.ts. Never set this anywhere else.
      E2E_FAULT_ROUTES: "e2e-test-server-only",
      // The AI assistant talks to a local stand-in server started by global-setup; the real provider is never contacted by tests.
      AI_EXTRACTION_ENABLED: "true",
      ANTHROPIC_API_KEY: "e2e-stand-in-key-not-real",
      AI_API_BASE: "http://127.0.0.1:3199",
    },
  },
});

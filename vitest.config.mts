import path from "node:path";
import { defineConfig } from "vitest/config";

const alias = { "@": path.resolve(import.meta.dirname, "src") };

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: { name: "unit", include: ["src/**/*.test.ts"], environment: "node" },
      },
      {
        resolve: { alias },
        test: {
          name: "db",
          include: ["db/tests/**/*.test.ts"],
          environment: "node",
          setupFiles: ["db/tests/env.ts"],
          globalSetup: ["db/tests/global-setup.ts"],
          fileParallelism: false, // DB tests share one database
          testTimeout: 30_000,
        },
      },
    ],
  },
});

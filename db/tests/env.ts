import "dotenv/config";

// DB tests must only ever touch the dedicated *_test database.
for (const key of ["TEST_DATABASE_URL", "TEST_MIGRATE_DATABASE_URL"]) {
  const v = process.env[key];
  if (!v) throw new Error(`${key} is not set (copy .env.example to .env)`);
  if (!/\/[A-Za-z0-9_]*_test(\?|$)/.test(v)) throw new Error(`${key} must point at a *_test database`);
}

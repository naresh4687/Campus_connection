import "dotenv/config";
import { Client } from "pg";
import { createInterface } from "node:readline";
import { hashPassword, newPasswordSchema } from "../src/server/auth/password";

/**
 * One-time bootstrap of the first PLATFORM_SUPER_ADMIN. Runs as the migration/owner role (the runtime role
 * is not allowed to call auth.bootstrap_platform_admin) and refuses if a platform admin already exists.
 *
 *   npm run admin:create -- you@yourdomain.example "Your Name"
 * The password is read from PLATFORM_ADMIN_PASSWORD or prompted (input hidden).
 */
async function promptHidden(label: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const write = (rl as unknown as { _writeToOutput: (s: string) => void });
  return new Promise((resolve) => {
    process.stdout.write(label);
    write._writeToOutput = () => {};
    rl.question("", (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); });
  });
}

async function main() {
  const [email, name] = process.argv.slice(2);
  if (!email || !name) throw new Error('usage: npm run admin:create -- <email> "<full name>"');
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("MIGRATE_DATABASE_URL is not set");
  const password = process.env.PLATFORM_ADMIN_PASSWORD ?? (await promptHidden("Password (min 10 chars): "));
  const parsed = newPasswordSchema.safeParse(password);
  if (!parsed.success) throw new Error(parsed.error.issues[0].message);

  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query("SELECT auth.bootstrap_platform_admin($1, $2, $3) AS id", [email, name, await hashPassword(password)]);
    console.log(`Platform admin created: ${r.rows[0].id}`);
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });

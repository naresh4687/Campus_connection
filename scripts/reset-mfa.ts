import "dotenv/config";
import { Client } from "pg";

/**
 * Last resort for a platform administrator who lost both the phone and the recovery codes (nobody is above them in the app).
 * Runs as the database owner:  npm run admin:reset-mfa -- you@yourdomain.example
 */
async function main() {
  const [email] = process.argv.slice(2);
  if (!email) throw new Error("usage: npm run admin:reset-mfa -- <email>");
  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) throw new Error("MIGRATE_DATABASE_URL is not set");
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE cc_auth");
    const u = (await c.query<{ id: string }>("SELECT id FROM users WHERE email = $1 AND role = 'PLATFORM_SUPER_ADMIN'", [email])).rows[0];
    if (!u) throw new Error("No platform administrator has that email.");
    await c.query("DELETE FROM user_mfa WHERE user_id = $1", [u.id]);
    await c.query("DELETE FROM mfa_recovery_codes WHERE user_id = $1", [u.id]);
    await c.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [u.id]);
    await c.query("SELECT auth.write_audit('PLATFORM', NULL, $1, 'PLATFORM_SUPER_ADMIN', 'MFA_RESET', 'user', $1::text, '{\"by\":\"owner_script\"}'::jsonb, NULL)", [u.id]);
    await c.query("COMMIT");
    console.log("Two-step sign-in removed. Sign in with the password and set it up again.");
  } finally {
    await c.end();
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });

import { Client } from "pg";

export const appUrl = () => process.env.TEST_DATABASE_URL!;
export const ownerUrl = () => process.env.TEST_MIGRATE_DATABASE_URL!;

export async function withOwner<T>(fn: (c: Client) => Promise<T>): Promise<T> {
  const c = new Client({ connectionString: ownerUrl() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

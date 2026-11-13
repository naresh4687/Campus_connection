import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

// Argon2id, OWASP-recommended minimum cost profile (19 MiB, 2 iterations, 1 lane).
const OPTS = { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export const hashPassword = (plain: string) => hash(plain, OPTS);

export async function verifyPassword(hashed: string, plain: string): Promise<boolean> {
  try {
    return await verify(hashed, plain);
  } catch {
    return false;
  }
}

/** Verified against when the account does not exist, so response time does not reveal which emails are registered. */
let dummy: Promise<string> | undefined;
export const dummyHash = () => (dummy ??= hashPassword("not-a-real-password-for-timing-equalisation"));

export const newPasswordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(128, "Use at most 128 characters.");

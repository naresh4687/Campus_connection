import type { z } from "zod";

/** Result shape shared by all form server actions. `invite` carries a one-time link that is shown exactly once. */
export type ActionState =
  | { error?: string; ok?: string; invite?: { link: string; email: string; expires: string }; values?: Record<string, string>; fieldErrors?: Record<string, string>; table?: { headers: string[]; rows: string[][] }; notes?: string[] }
  | undefined;

export const GENERIC_ERROR = "Something went wrong. Please try again.";

/** Maps database errors raised by OUR functions to safe messages. Anything unexpected becomes a generic message (and is logged). */
export function dbMessage(e: unknown): string {
  const err = e as { code?: string; message?: string };
  if (err.code === "42501") return "You are not allowed to do that.";
  const ours = err.message && !/invalid input syntax|duplicate key|violates/.test(err.message);
  if ((err.code === "22023" || err.code === "23505") && ours) return err.message!;
  if (err.code === "23505") return "That already exists.";
  console.error("action failed:", err.code, err.message);
  return GENERIC_ERROR;
}

export const str = (fd: FormData, k: string, max = 2000) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.slice(0, max) : "";
};

export const firstErrors = (err: z.ZodError) => {
  const out: Record<string, string> = {};
  for (const i of err.issues) out[String(i.path[0] ?? "form")] ??= i.message;
  return out;
};

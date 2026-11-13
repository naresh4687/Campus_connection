import { z } from "zod";

export const ROLES = [
  "PLATFORM_SUPER_ADMIN",
  "COLLEGE_ADMIN",
  "PLACEMENT_OFFICER",
  "COORDINATOR",
  "STUDENT",
] as const;
export type Role = (typeof ROLES)[number];

/**
 * Trusted request context. Must be built ONLY from a server-verified session,
 * never from request bodies, query strings, headers or raw cookie values.
 *
 * Only `userId` is sent to the database. The database derives the user's role and college itself
 * (app.current_role / app.current_college_id); `withTenantTx` then verifies that the derived values
 * match the ones carried here, so a stale or inconsistent context fails loudly instead of silently.
 */
export const requestContextSchema = z
  .object({
    userId: z.uuid(),
    collegeId: z.uuid().nullable(),
    role: z.enum(ROLES),
  })
  .refine((c) => (c.role === "PLATFORM_SUPER_ADMIN") === (c.collegeId === null), {
    message: "collegeId must be null for platform admins and set for every other role",
  });
export type RequestContext = z.infer<typeof requestContextSchema>;

export class ContextMismatchError extends Error {
  constructor() {
    super("Request context does not match the database's view of this user");
    this.name = "ContextMismatchError";
  }
}

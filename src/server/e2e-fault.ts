import { notFound } from "next/navigation";

/**
 * Deliberate-crash pages exist only so the browser tests can check the error pages. They are on only when the
 * Playwright test server sets this exact value; everywhere else (including production) they are a plain 404.
 */
export function faultRoutesEnabled(): boolean {
  return process.env.E2E_FAULT_ROUTES === "e2e-test-server-only";
}

export function throwDeliberateFault(where: string): never {
  if (!faultRoutesEnabled()) notFound();
  throw new Error(`Deliberate test fault (${where}). If you see this outside the browser tests, E2E_FAULT_ROUTES is set where it should not be.`);
}

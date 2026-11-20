"use client";

import { CenteredShell } from "@/components/layout/centered-shell";
import { ErrorDetails } from "@/components/error-details";

// Unexpected errors outside the signed-in portal. Replaces Next's built-in error page, whose inline styles the CSP blocks.
export default function RootError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <CenteredShell title="Something went wrong">
      <ErrorDetails error={error} retry={retry} homeHref="/" homeLabel="Go to the home page" />
    </CenteredShell>
  );
}

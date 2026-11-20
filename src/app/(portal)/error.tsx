"use client";

import { ErrorDetails } from "@/components/error-details";

// Unexpected errors inside the portal. Renders inside the portal shell (which supplies <main>), so the user keeps their navigation.
export default function PortalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="mx-auto w-full max-w-2xl py-12 sm:py-20">
      <h1 className="text-3xl font-semibold tracking-tight">Something went wrong</h1>
      <div className="mt-3"><ErrorDetails error={error} retry={retry} homeHref="/" homeLabel="Back to your dashboard" /></div>
    </div>
  );
}

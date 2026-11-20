"use client";

import "./globals.css";
import { CenteredShell } from "@/components/layout/centered-shell";
import { ErrorDetails } from "@/components/error-details";

// Last resort when the root layout itself fails. It replaces the root layout, so it brings its own document and stylesheet
// (no inline styles: the CSP blocks them). Fonts fall back to the system stack here.
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <title>Something went wrong — CampusConnect</title>
        <CenteredShell title="Something went wrong">
          <ErrorDetails error={error} retry={retry} homeHref="/" homeLabel="Go to the home page" />
        </CenteredShell>
      </body>
    </html>
  );
}

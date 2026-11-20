"use client";

import Link from "next/link";
import { buttonClass } from "@/components/ui/button";

/** Body of the "something went wrong" pages. Shows the error's digest (never its message) so support can match it to the server log. */
export function ErrorDetails({ error, retry, homeHref, homeLabel }: { error: unknown; retry: () => void; homeHref: string; homeLabel: string }) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : null;
  return (
    <div className="space-y-5">
      <p className="text-muted">
        This page couldn&apos;t be loaded because of an unexpected error. Please try again. If it keeps happening, contact support and quote the reference below.
      </p>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <button type="button" onClick={() => retry()} className={buttonClass("primary")}>
          Try again
        </button>
        <Link href={homeHref} className={buttonClass("secondary")}>
          {homeLabel}
        </Link>
      </div>
      {digest ? <p className="text-xs text-muted">Reference: <code className="font-mono">{digest}</code></p> : null}
    </div>
  );
}

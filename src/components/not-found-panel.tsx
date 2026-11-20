import Link from "next/link";
import type { ReactNode } from "react";
import { buttonClass } from "@/components/ui/button";

/** Shared "page not found" message. The page around it (public site or signed-in portal) chooses the links and supplies the <main> landmark. */
export function NotFoundPanel({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-2xl py-12 sm:py-20">
      <p className="display text-5xl">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-3 text-muted">
        This page doesn&apos;t exist, or you don&apos;t have access to it. Check the address, or use one of the links below.
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-3 text-sm">{children}</div>
    </div>
  );
}

export function NotFoundPrimaryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass("primary")}>
      {children}
    </Link>
  );
}

export function NotFoundLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass("secondary")}>
      {children}
    </Link>
  );
}

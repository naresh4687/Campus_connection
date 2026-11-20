import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/ui/logo";

/**
 * Centred card with the logo and a title. Safe in Client Components (the error pages use it directly);
 * AuthShell adds the theme switch, which reads a cookie on the server.
 */
export function CenteredShell({ title, corner, children }: { title: string; corner?: ReactNode; children: ReactNode }) {
  return (
    <main className="relative flex flex-1 items-center justify-center overflow-hidden px-4 py-12">
      {corner ? <div className="absolute right-4 top-4">{corner}</div> : null}
      <div className="rise relative w-full max-w-md space-y-6">
        <div className="text-center">
          <Link href="/" className="inline-flex items-center gap-2.5 text-[1.05rem] font-bold tracking-tight [font-stretch:112%]"><Logo />CampusConnect</Link>
          <h1 className="mt-4 text-2xl font-bold tracking-tight">{title}</h1>
        </div>
        <div className="rounded-[1.75rem] border border-border bg-surface p-6 sm:p-7">{children}</div>
      </div>
    </main>
  );
}

import Link from "next/link";
import type { ReactNode } from "react";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { CenteredShell } from "./centered-shell";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return (
    <CenteredShell title={title} corner={<ThemeSwitch />}>
      {children}
      <p className="mt-5 flex justify-center gap-5 text-xs text-muted">
        <Link href="/privacy" className="hover:text-foreground hover:underline">Privacy policy</Link>
        <Link href="/terms" className="hover:text-foreground hover:underline">Terms of service</Link>
      </p>
    </CenteredShell>
  );
}

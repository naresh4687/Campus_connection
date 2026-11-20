import type { ReactNode } from "react";
import { ThemeSwitch } from "@/components/ui/theme-switch";
import { CenteredShell } from "./centered-shell";

export function AuthShell({ title, children }: { title: string; children: ReactNode }) {
  return <CenteredShell title={title} corner={<ThemeSwitch />}>{children}</CenteredShell>;
}

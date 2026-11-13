import type { ReactNode } from "react";

const tone = {
  error: "border-danger/40 text-danger",
  success: "border-success/40 text-success",
  info: "border-border text-muted",
} as const;

export function Alert({ kind = "info", children }: { kind?: keyof typeof tone; children: ReactNode }) {
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rounded-md border bg-surface px-3 py-2 text-sm ${tone[kind]}`}>
      {children}
    </div>
  );
}

import type { ReactNode } from "react";

const tone = {
  error: { box: "border-danger/45 bg-danger/8", bar: "bg-danger", text: "text-danger" },
  success: { box: "border-brand bg-brand/25", bar: "bg-brand", text: "text-foreground" },
  info: { box: "border-transparent bg-surface neu-inset", bar: "bg-muted/50", text: "text-muted" },
} as const;

export function Alert({ kind = "info", children }: { kind?: keyof typeof tone; children: ReactNode }) {
  const t = tone[kind];
  return (
    <div role={kind === "error" ? "alert" : "status"} className={`rise relative overflow-hidden rounded-xl border py-2.5 pl-4 pr-4 text-sm ${t.box} ${t.text}`}>
      <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${t.bar}`} />
      {children}
    </div>
  );
}

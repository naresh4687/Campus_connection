import type { InputHTMLAttributes } from "react";

export function Field({ label, id, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string; error?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
      <input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
        className={`h-11 w-full rounded-xl border bg-surface px-3 text-sm outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/35 focus-visible:border-foreground focus-visible:ring-4 focus-visible:ring-brand/35 ${error ? "border-danger" : "border-border"}`}
      />
      {error ? <p id={`${id}-error`} className="text-xs text-danger">{error}</p> : hint ? <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

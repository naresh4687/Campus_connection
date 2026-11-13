import type { InputHTMLAttributes } from "react";

export function Field({ label, id, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; id: string; hint?: string; error?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <input
        id={id}
        name={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined}
        {...props}
        className={`h-10 w-full rounded-xl border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${error ? "border-danger" : "border-border"}`}
      />
      {error ? <p id={`${id}-error`} className="text-xs text-danger">{error}</p> : hint ? <p id={`${id}-hint`} className="text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

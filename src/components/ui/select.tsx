import type { SelectHTMLAttributes } from "react";

export function Select({ label, id, name, error, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string; error?: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">{label}</label>
      <select id={id} name={name ?? id} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...props}
        className={`h-10 w-full rounded-xl border bg-surface px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${error ? "border-danger" : "border-border"}`}>
        {children}
      </select>
      {error ? <p id={`${id}-error`} className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

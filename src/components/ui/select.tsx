import type { SelectHTMLAttributes } from "react";

export function Select({ label, id, name, error, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; id: string; error?: string }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm font-semibold">{label}</label>
      <select id={id} name={name ?? id} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} {...props}
        className={`h-11 w-full rounded-xl border bg-surface px-3 text-sm outline-none transition-[border-color,box-shadow] duration-150 hover:border-foreground/35 focus-visible:border-foreground focus-visible:ring-4 focus-visible:ring-brand/35 ${error ? "border-danger" : "border-border"}`}>
        {children}
      </select>
      {error ? <p id={`${id}-error`} className="text-xs text-danger">{error}</p> : null}
    </div>
  );
}

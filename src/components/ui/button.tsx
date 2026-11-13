import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "danger";
const styles: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground shadow-[0_6px_16px_-8px_var(--primary)] hover:-translate-y-px hover:opacity-95",
  secondary: "border border-border bg-surface text-foreground hover:bg-tint",
  danger: "bg-danger text-white hover:opacity-90",
};

export function Button({ variant = "primary", className = "", ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      className={`inline-flex h-10 items-center justify-center rounded-xl px-4 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60 ${styles[variant]} ${className}`}
    />
  );
}

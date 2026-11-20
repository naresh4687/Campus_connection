import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
const styles: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/88",
  secondary: "border border-border bg-surface text-foreground hover:border-foreground/30 hover:bg-tint",
  danger: "bg-danger text-danger-foreground hover:bg-danger/90",
  ghost: "text-foreground hover:bg-tint",
};

/** Shared look of every button and button-styled link: pill shape, press feedback, visible focus. */
export const buttonClass = (variant: Variant = "primary", extra = "") =>
  `inline-flex h-10 select-none items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-[background-color,border-color,transform] duration-150 active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-55 ${styles[variant]} ${extra}`;

/** Small spinner for pending states. Decorative: the button's text says what is happening. */
export function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className={`h-4 w-4 animate-spin motion-reduce:animate-none ${className}`}>
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Button({ variant = "primary", className = "", pending, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; pending?: boolean }) {
  return (
    <button {...props} aria-busy={pending || undefined} className={buttonClass(variant, className)}>
      {pending ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function ButtonLink({ variant = "primary", className = "", ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link {...props} className={buttonClass(variant, className)} />;
}

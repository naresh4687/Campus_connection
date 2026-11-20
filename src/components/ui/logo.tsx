/** The CampusConnect mark: a lime tile with an ink "C" drawn as an open ring. Decorative; the product name is always written next to it. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 28 28" className={`h-7 w-7 shrink-0 ${className}`}>
      <rect width="28" height="28" rx="8" className="fill-brand" />
      <path d="M19.4 9.6a7 7 0 1 0 0 8.8" fill="none" strokeWidth="3.4" strokeLinecap="round" className="stroke-brand-foreground" />
    </svg>
  );
}

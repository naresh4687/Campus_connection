/** The CampusConnect mark: a gradient tile with a white dot. Decorative; the product name is always written next to it. */
export function Logo({ className = "" }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`relative inline-block h-7 w-7 shrink-0 rounded-[10px] bg-linear-to-br from-primary to-accent ${className}`}>
      <span className="absolute inset-[9px] rounded-full bg-white" />
    </span>
  );
}

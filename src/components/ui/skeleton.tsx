/** Loading placeholders. Shapes follow the real layout so nothing jumps when the content arrives. Hidden from screen readers; the region says "Loading". */
export function Skeleton({ className = "" }: { className?: string }) {
  return <span aria-hidden="true" className={`skeleton block ${className}`} />;
}

/** A page-shaped placeholder for portal sections: title, a row of numbers, then a table. Used by loading.tsx files. */
export function PageSkeleton({ stats = 3, rows = 6 }: { stats?: number; rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-6">
      <span className="sr-only">Loading…</span>
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {stats > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: stats }, (_, i) => (
            <div key={i} className="space-y-3 card p-5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-16" />
            </div>
          ))}
        </div>
      ) : null}
      <div className="overflow-hidden card">
        <div className="border-b border-border px-4 py-3"><Skeleton className="h-4 w-40" /></div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
            <Skeleton className="h-4 w-1/4" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="ml-auto h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

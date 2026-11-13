import Link from "next/link";

export const PAGE_SIZE = 15;

/** Server-driven pagination: keeps every other query parameter, changes only `page`. */
export function Pagination({ page, total, basePath, params }: { page: number; total: number; basePath: string; params: Record<string, string | undefined> }) {
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const href = (p: number) => {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) sp.set(k, v);
    if (p > 1) sp.set("page", String(p));
    const qs = sp.toString();
    return qs ? `${basePath}?${qs}` : basePath;
  };
  const from = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, page * PAGE_SIZE);
  const link = "rounded-md border border-border px-3 py-1.5 text-sm hover:bg-background";
  return (
    <nav aria-label="Pagination" className="flex flex-wrap items-center justify-between gap-2 pt-4 text-sm">
      <p className="text-muted" data-testid="page-summary">{total === 0 ? "No results" : `Showing ${from}–${to} of ${total}`}</p>
      <div className="flex gap-2">
        {page > 1 ? <Link href={href(page - 1)} className={link} rel="prev">Previous</Link> : <span className={`${link} opacity-50`} aria-disabled="true">Previous</span>}
        {page < pages ? <Link href={href(page + 1)} className={link} rel="next">Next</Link> : <span className={`${link} opacity-50`} aria-disabled="true">Next</span>}
      </div>
    </nav>
  );
}

export const parsePage = (v: string | undefined) => {
  const n = Number.parseInt(v ?? "1", 10);
  return Number.isFinite(n) && n >= 1 && n <= 100000 ? n : 1;
};

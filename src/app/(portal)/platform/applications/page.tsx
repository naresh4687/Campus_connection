import Link from "next/link";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { APPLICATION_STATUSES, listApplications } from "@/server/platform/queries";

export const metadata = { title: "College applications — CampusConnect" };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ status?: string; q?: string; page?: string }> }) {
  const s = await requireRole("PLATFORM_SUPER_ADMIN");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const status = (APPLICATION_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const page = parsePage(sp.page);
  const { rows, total, counts } = await listApplications(s, { status, q, page });
  const chip = (value: string | undefined, label: string, n?: number) => {
    const sel = new URLSearchParams(); if (value) sel.set("status", value); if (q) sel.set("q", q);
    const active = (value ?? "") === (status ?? "");
    return <Link key={label} href={`/platform/applications${sel.size ? `?${sel}` : ""}`} aria-current={active ? "page" : undefined}
      className={`rounded-full border px-3 py-1 text-sm ${active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-background"}`}>{label}{n !== undefined ? ` (${n})` : ""}</Link>;
  };
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">College applications</h1>
      <div className="flex flex-wrap items-center gap-2">
        {chip(undefined, "All", Object.values(counts).reduce((a, b) => a + b, 0))}
        {APPLICATION_STATUSES.map((st) => chip(st, humanize(st), counts[st] ?? 0))}
      </div>
      <form className="flex flex-wrap gap-2" role="search">
        {status ? <input type="hidden" name="status" value={status} /> : null}
        <input name="q" defaultValue={q} placeholder="Search name, email or district" aria-label="Search applications" className="h-10 w-72 max-w-full rounded-md border border-border bg-surface px-3 text-sm" />
        <button className="h-10 rounded-md border border-border bg-surface px-4 text-sm hover:bg-background">Search</button>
        {q ? <Link href={`/platform/applications${status ? `?status=${status}` : ""}`} className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>
      <Table head={["College", "Location", "Submitted", "Status"]} empty={rows.length === 0 ? <EmptyState title="No applications found">{q || status ? "Try a different filter or search." : "Applications submitted from the public site appear here."}</EmptyState> : undefined}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td><Link href={`/platform/applications/${r.id}`} className="font-medium underline">{r.name}</Link></Td>
            <Td>{r.district}, {r.state}</Td>
            <Td>{fmtDateTime(r.submitted_at)}</Td>
            <Td><StatusBadge value={r.status} /></Td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={total} basePath="/platform/applications" params={{ status, q }} />
    </div>
  );
}

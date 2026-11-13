import Link from "next/link";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import type { CompanyRow } from "@/server/companies/queries";

/** Shared by the officer (manage) and admin (read-only) lists; only the base path differs. */
export function CompanyList({ base, rows, total, industries, q, status, industry, page }: { base: string; rows: CompanyRow[]; total: number; industries: string[]; q?: string; status?: string; industry?: string; page: number }) {
  const any = q || status || industry;
  return (
    <>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="space-y-1">
          <label htmlFor="q" className="block text-sm font-medium">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Name, industry, location or contact" className="h-10 w-64 max-w-full rounded-md border border-border bg-surface px-3 text-sm" />
        </div>
        <Select id="status" label="Status" defaultValue={status ?? ""}><option value="">Any</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option></Select>
        <Select id="industry" label="Industry" defaultValue={industry ?? ""}><option value="">All</option>{industries.map((i) => <option key={i} value={i}>{i}</option>)}</Select>
        <button className="h-10 rounded-md border border-border bg-surface px-4 text-sm hover:bg-background">Apply filters</button>
        {any ? <Link href={base} className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>
      <Table head={["Company", "Industry", "Location", "Contact", "Status", "Updated"]} empty={rows.length === 0 ? <EmptyState title="No companies found">{any ? "Try different filters." : "Companies you add appear here."}</EmptyState> : undefined}>
        {rows.map((c) => (
          <tr key={c.id}>
            <Td><Link href={`${base}/${c.id}`} className="font-medium underline">{c.name}</Link></Td>
            <Td>{c.industry ?? "—"}</Td><Td>{c.location ?? "—"}</Td><Td>{c.contact_person ?? "—"}</Td>
            <Td><StatusBadge value={c.status} /></Td><Td>{fmtDate(c.updated_at)}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={total} basePath={base} params={{ q, status, industry }} />
    </>
  );
}

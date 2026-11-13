import Link from "next/link";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { fmtDate } from "@/lib/format";
import { COMMERCIAL_STATUSES } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { listColleges } from "@/server/platform/queries";

export const metadata = { title: "Colleges — CampusConnect" };

export default async function CollegesPage({ searchParams }: { searchParams: Promise<{ access?: string; commercial?: string; q?: string; page?: string }> }) {
  const s = await requireRole("PLATFORM_SUPER_ADMIN");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const access = sp.access === "ACTIVE" || sp.access === "SUSPENDED" ? sp.access : undefined;
  const commercial = (COMMERCIAL_STATUSES as readonly string[]).includes(sp.commercial ?? "") ? sp.commercial : undefined;
  const page = parsePage(sp.page);
  const { rows, total } = await listColleges(s, { access, commercial, q, page });
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Colleges</h1>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="space-y-1">
          <label htmlFor="q" className="block text-sm font-medium">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Name, district or state" className="h-10 w-64 max-w-full rounded-xl border border-border bg-surface px-3 text-sm" />
        </div>
        <Select id="access" label="Access" defaultValue={access ?? ""}>
          <option value="">All</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option>
        </Select>
        <Select id="commercial" label="Commercial status" defaultValue={commercial ?? ""}>
          <option value="">All</option>
          {COMMERCIAL_STATUSES.map((c) => <option key={c} value={c}>{c.toLowerCase().replace(/_/g, " ").replace(/^./, (x) => x.toUpperCase())}</option>)}
        </Select>
        <button className="h-10 rounded-xl border border-border bg-surface px-4 text-sm hover:bg-background">Apply filters</button>
        {q || access || commercial ? <Link href="/platform/colleges" className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>
      <Table head={["College", "Location", "Access", "Commercial", "Administrator", "Created"]} empty={rows.length === 0 ? <EmptyState title="No colleges found">{q || access || commercial ? "Try different filters." : "Colleges appear here once an application is approved."}</EmptyState> : undefined}>
        {rows.map((c) => (
          <tr key={c.id}>
            <Td><Link href={`/platform/colleges/${c.id}`} className="font-medium underline">{c.name}</Link></Td>
            <Td>{[c.district, c.state].filter(Boolean).join(", ") || "—"}</Td>
            <Td><StatusBadge value={c.status} /></Td>
            <Td><StatusBadge value={c.commercial_status} /></Td>
            <Td><StatusBadge value={c.admin_state} label={c.admin_state === "NO_INVITATION" ? "No invitation" : c.admin_state === "INVITED" ? "Invited" : "Active"} /></Td>
            <Td>{fmtDate(c.created_at)}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={total} basePath="/platform/colleges" params={{ q, access, commercial }} />
    </div>
  );
}

import Link from "next/link";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { humanize } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { listAudit } from "@/server/platform/queries";

export const metadata = { title: "Audit log — CampusConnect" };

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ action?: string; page?: string }> }) {
  const s = await requireRole("PLATFORM_SUPER_ADMIN");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { rows, total, actions } = await listAudit(s, { action: sp.action, page });
  const action = actions.includes(sp.action ?? "") ? sp.action : undefined;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Platform audit log</h1>
      <p className="text-sm text-muted">Append-only record of platform-level actions. Entries cannot be edited or deleted.</p>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="space-y-1">
          <label htmlFor="action" className="block text-sm font-medium">Action</label>
          <select id="action" name="action" defaultValue={action ?? ""} className="h-10 rounded-xl border border-border bg-surface px-3 text-sm">
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{humanize(a)}</option>)}
          </select>
        </div>
        <button className="h-10 rounded-xl border border-border bg-surface px-4 text-sm hover:bg-background">Filter</button>
        {action ? <Link href="/platform/audit" className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>
      <Table head={["When", "Action", "By", "Subject", "Details"]} empty={rows.length === 0 ? <EmptyState title="No entries" /> : undefined}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td className="whitespace-nowrap">{fmtDateTime(r.occurred_at)}</Td>
            <Td>{humanize(r.action)}</Td>
            <Td>{r.actor_email ?? <span className="text-muted">public / system</span>}</Td>
            <Td className="font-mono text-xs">{r.entity_type ? `${r.entity_type}:${(r.entity_id ?? "").slice(0, 8)}` : "—"}</Td>
            <Td className="font-mono text-xs">{Object.keys(r.metadata ?? {}).length ? JSON.stringify(r.metadata) : "—"}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={total} basePath="/platform/audit" params={{ action }} />
    </div>
  );
}

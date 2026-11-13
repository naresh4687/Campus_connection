import Link from "next/link";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { SUBMISSION_LABEL } from "@/lib/academics";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { decisionHistory } from "@/server/academics/queries";

export const metadata = { title: "Verification history — CampusConnect" };

const TONE: Record<string, string> = { VERIFIED: "APPROVED", REJECTED: "REJECTED", SUPERSEDED: "NOT_STARTED" };

export default async function VerificationHistory({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string; status?: string; page?: string }> }) {
  const s = await requireRole("COORDINATOR");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const status = ["VERIFIED", "REJECTED", "SUPERSEDED"].includes(sp.status ?? "") ? sp.status : undefined;
  const page = parsePage(sp.page);
  const { rows, total, depts } = await decisionHistory(s, { q, status, dept: sp.dept || undefined, page });
  const dept = depts.some((d) => d.id === sp.dept) ? sp.dept : undefined;
  return (
    <div className="space-y-5">
      <p className="text-sm"><Link href="/coordinator/verification" className="underline">← Verification queue</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Verification history</h1>
      <p className="text-sm text-muted">Decisions on submissions from students of your departments, most recent first.</p>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="space-y-1">
          <label htmlFor="q" className="block text-sm font-medium">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Student name or register number" className="h-10 w-64 max-w-full rounded-md border border-border bg-surface px-3 text-sm" />
        </div>
        <Select id="status" label="Outcome" defaultValue={status ?? ""}><option value="">All</option><option value="VERIFIED">Verified</option><option value="REJECTED">Rejected</option><option value="SUPERSEDED">Superseded</option></Select>
        <Select id="dept" label="Department" defaultValue={dept ?? ""}><option value="">All my departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</Select>
        <button className="h-10 rounded-md border border-border bg-surface px-4 text-sm hover:bg-background">Apply filters</button>
        {q || dept || status ? <Link href="/coordinator/verification/history" className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>
      <Table head={["Student", "Department", "Version", "Outcome", "Reviewed by", "Reviewed"]} empty={rows.length === 0 ? <EmptyState title="No decisions yet" /> : undefined}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td><Link href={`/coordinator/verification/${r.id}`} className="font-medium underline">{r.full_name}</Link><span className="block font-mono text-xs text-muted">{r.register_number}</span></Td>
            <Td>{r.dept_code}</Td>
            <Td>{r.version}</Td>
            <Td><StatusBadge value={TONE[r.status]} label={SUBMISSION_LABEL[r.status]} /></Td>
            <Td>{r.reviewed_by_name ?? "—"}</Td>
            <Td>{fmtDateTime(r.reviewed_at)}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={total} basePath="/coordinator/verification/history" params={{ q, dept, status }} />
    </div>
  );
}

import Link from "next/link";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { reviewQueue } from "@/server/academics/queries";

export const metadata = { title: "Verification queue — CampusConnect" };

export default async function VerificationQueue({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string; page?: string }> }) {
  const s = await requireRole("COORDINATOR");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const page = parsePage(sp.page);
  const { rows, total, depts } = await reviewQueue(s, { q, dept: sp.dept || undefined, page });
  const dept = depts.some((d) => d.id === sp.dept) ? sp.dept : undefined;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Verification queue</h1>
        <Link href="/coordinator/verification/history" className="text-sm underline">Verification history</Link>
      </div>
      <p className="text-sm text-muted">Academic submissions from students of your departments, oldest first. Compare each with the college’s records, then verify or reject with a reason.</p>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="space-y-1">
          <label htmlFor="q" className="block text-sm font-medium">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Student name or register number" className="h-10 w-64 max-w-full rounded-md border border-border bg-surface px-3 text-sm" />
        </div>
        <Select id="dept" label="Department" defaultValue={dept ?? ""}><option value="">All my departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</Select>
        <button className="h-10 rounded-md border border-border bg-surface px-4 text-sm hover:bg-background">Apply filters</button>
        {q || dept ? <Link href="/coordinator/verification" className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>
      <Table head={["Student", "Register no.", "Department", "Submitted", "Version", ""]} empty={rows.length === 0 ? <EmptyState title="Nothing to review">{q || dept ? "No pending submissions match." : "New submissions from your students will appear here."}</EmptyState> : undefined}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td><Link href={`/coordinator/verification/${r.id}`} className="font-medium underline">{r.full_name}</Link></Td>
            <Td className="font-mono text-xs">{r.register_number}</Td>
            <Td>{r.dept_code}</Td>
            <Td>{fmtDateTime(r.submitted_at)}</Td>
            <Td>{r.version}</Td>
            <Td>{r.update_of_verified ? <StatusBadge value="PENDING" label="Update to verified record" /> : null}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={total} basePath="/coordinator/verification" params={{ q, dept }} />
    </div>
  );
}

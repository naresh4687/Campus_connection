import Link from "next/link";
import { Pagination } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { DRIVE_STATUS_LABEL, employmentLabel } from "@/lib/drives";
import { fmtDateTime } from "@/lib/format";
import type { DriveRow } from "@/server/drives/queries";

const TONE: Record<string, string> = { DRAFT: "PENDING", PUBLISHED: "APPROVED", CLOSED: "NOT_STARTED", ARCHIVED: "NOT_STARTED" };

export function DriveList({ base, rows, total, counts, q, status, page }: { base: string; rows: DriveRow[]; total: number; counts: Record<string, number>; q?: string; status?: string; page: number }) {
  const any = q || status;
  return (
    <>
      <div className="flex flex-wrap gap-2" aria-label="Status counts">
        {["", "DRAFT", "PUBLISHED", "CLOSED", "ARCHIVED"].map((s) => (
          <Link key={s || "all"} href={s ? `${base}?status=${s}` : base} aria-current={(status ?? "") === s ? "page" : undefined}
            className={`rounded-full border px-3 py-1 text-sm ${(status ?? "") === s ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-background"}`}>
            {s ? DRIVE_STATUS_LABEL[s] : "All"} ({s ? counts[s] ?? 0 : Object.values(counts).reduce((a, b) => a + b, 0)})
          </Link>
        ))}
      </div>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="space-y-1"><label htmlFor="q" className="block text-sm font-medium">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Job title, company or location" className="h-10 w-64 max-w-full rounded-xl border border-border bg-surface px-3 text-sm" /></div>
        <Select id="status" label="Status" defaultValue={status ?? ""}><option value="">Any</option>{Object.entries(DRIVE_STATUS_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <button className="h-10 rounded-xl border border-border bg-surface px-4 text-sm hover:bg-background">Apply filters</button>
        {any ? <Link href={base} className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>
      <Table head={["Job", "Company", "Type", "Apply by", "Openings", "Status"]} empty={rows.length === 0 ? <EmptyState title="No drives found">{any ? "Try different filters." : "Drives you create appear here."}</EmptyState> : undefined}>
        {rows.map((d) => (
          <tr key={d.id}>
            <Td><Link href={`${base}/${d.id}`} className="font-medium underline">{d.job_title}</Link></Td>
            <Td>{d.company_name}</Td><Td>{employmentLabel(d.employment_type)}</Td>
            <Td>{d.application_deadline ? fmtDateTime(d.application_deadline) : "—"}</Td><Td>{d.openings ?? "—"}</Td>
            <Td><StatusBadge value={TONE[d.status]} label={DRIVE_STATUS_LABEL[d.status]} /></Td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={total} basePath={base} params={{ q, status }} />
    </>
  );
}

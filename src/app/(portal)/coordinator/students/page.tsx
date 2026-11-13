import Link from "next/link";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { ACADEMIC_LABEL } from "@/lib/academics";
import { requireRole } from "@/server/auth/session";
import { listStudents } from "@/server/students/queries";

export const metadata = { title: "Department students — CampusConnect" };

export default async function CoordinatorStudents({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string; year?: string; academics?: string; page?: string }> }) {
  const s = await requireRole("COORDINATOR");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  // No department or college condition is built here: row-level security returns only the students of this coordinator's departments.
  const { rows, total, depts, years } = await listStudents(s, { q, dept: sp.dept || undefined, year: sp.year || undefined, academics: sp.academics || undefined, page: parsePage(sp.page) }, { admin: false });
  const academics = ["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED"].includes(sp.academics ?? "") ? sp.academics : undefined;
  const dept = depts.some((d) => d.id === sp.dept) ? sp.dept : undefined;
  const year = years.some((y) => String(y) === sp.year) ? sp.year : undefined;
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Department students</h1>
      <p className="text-sm text-muted">Students of the departments assigned to you.</p>
      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="space-y-1">
          <label htmlFor="q" className="block text-sm font-medium">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Name, register number or email" className="h-10 w-64 max-w-full rounded-xl border border-border bg-surface px-3 text-sm" />
        </div>
        <Select id="dept" label="Department" defaultValue={dept ?? ""}><option value="">All my departments</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</Select>
        <Select id="year" label="Passing year" defaultValue={year ?? ""}><option value="">All</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <Select id="academics" label="Academics" defaultValue={academics ?? ""}><option value="">Any</option>{Object.entries(ACADEMIC_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>
        <button className="h-10 rounded-xl border border-border bg-surface px-4 text-sm hover:bg-background">Apply filters</button>
        {q || dept || year || academics ? <Link href="/coordinator/students" className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>
      <Table head={["Student", "Register no.", "Department", "Degree", "Passing year", "Has account", "Academics"]} empty={rows.length === 0 ? <EmptyState title="No students">{depts.length === 0 ? "You are not assigned to any department yet." : "No students match."}</EmptyState> : undefined}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td><Link href={`/coordinator/students/${r.id}`} className="font-medium underline">{r.full_name}</Link><span className="block text-xs text-muted">{r.college_email}</span></Td>
            <Td className="font-mono text-xs">{r.register_number}</Td>
            <Td>{r.dept_code}</Td>
            <Td>{r.degree}</Td>
            <Td>{r.passing_year}</Td>
            <Td><StatusBadge value={r.has_account ? "ACTIVE" : "NOT_STARTED"} label={r.has_account ? "Yes" : "No"} /></Td>
            <Td><StatusBadge value={({ VERIFIED: "APPROVED", PENDING: "PENDING", REJECTED: "REJECTED", NOT_SUBMITTED: "NOT_STARTED" } as Record<string, string>)[r.academic_status]} label={ACADEMIC_LABEL[r.academic_status] + (r.update_pending ? " · update pending" : "")} /></Td>
          </tr>
        ))}
      </Table>
      <Pagination page={parsePage(sp.page)} total={total} basePath="/coordinator/students" params={{ q, dept, year, academics }} />
    </div>
  );
}

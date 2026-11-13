import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { ACADEMIC_LABEL } from "@/lib/academics";
import { requireRole } from "@/server/auth/session";
import { listInvitable, listStudents } from "@/server/students/queries";
import { BulkInvite } from "./bulk-invite";
import { ShareCard } from "@/components/join/share-card";
import { joinLinkState, pendingJoinCount } from "@/server/join/queries";
import { joinLink } from "@/server/join/link";

export const metadata = { title: "Students — CampusConnect" };

export default async function StudentsPage({ searchParams }: { searchParams: Promise<{ q?: string; dept?: string; year?: string; account?: string; academics?: string; page?: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const filters = { q, dept: sp.dept || undefined, year: sp.year || undefined, account: sp.account || undefined, academics: sp.academics || undefined, page: parsePage(sp.page) };
  const { rows, total, depts, years } = await listStudents(s, filters, { admin: true });
  const invitable = await listInvitable(s, filters, 1);
  const [jl, pending] = await Promise.all([joinLinkState(s), pendingJoinCount(s)]);
  const link = await joinLink(s.collegeId!, jl.version);
  const dept = depts.some((d) => d.id === sp.dept) ? sp.dept : undefined;
  const year = years.some((y) => String(y) === sp.year) ? sp.year : undefined;
  const account = ["NOT_INVITED", "INVITED", "ACTIVE", "DISABLED"].includes(sp.account ?? "") ? sp.account : undefined;
  const academics = ["NOT_SUBMITTED", "PENDING", "VERIFIED", "REJECTED"].includes(sp.academics ?? "") ? sp.academics : undefined;
  const anyFilter = q || dept || year || account || academics;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Students</h1>
        <div className="flex gap-2">
          <Link href="/college/students/import" className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-background">Import from CSV</Link>
          <Link href="/college/students/new" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground">Add student</Link>
        </div>
      </div>

      <Card title="Let students sign themselves up">
        <ShareCard link={link} enabled={jl.enabled} />
        <p className="mt-4 border-t border-border pt-4 text-sm"><Link href="/college/students/requests" className="font-medium underline">{pending > 0 ? `${pending} sign-up request${pending === 1 ? "" : "s"} waiting for approval` : "Sign-up requests"}</Link></p>
      </Card>

      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="space-y-1">
          <label htmlFor="q" className="block text-sm font-medium">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Name, register number or email" className="h-10 w-64 max-w-full rounded-xl border border-border bg-surface px-3 text-sm" />
        </div>
        <Select id="dept" label="Department" defaultValue={dept ?? ""}><option value="">All</option>{depts.map((d) => <option key={d.id} value={d.id}>{d.code}</option>)}</Select>
        <Select id="year" label="Passing year" defaultValue={year ?? ""}><option value="">All</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</Select>
        <Select id="account" label="Account" defaultValue={account ?? ""}>
          <option value="">Any</option><option value="NOT_INVITED">Not invited</option><option value="INVITED">Invited</option><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option>
        </Select>
        <Select id="academics" label="Academics" defaultValue={academics ?? ""}>
          <option value="">Any</option>{Object.entries(ACADEMIC_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <button className="h-10 rounded-xl border border-border bg-surface px-4 text-sm hover:bg-background">Apply filters</button>
        {anyFilter ? <Link href="/college/students" className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>

      <Table head={["Student", "Register no.", "Department", "Degree", "Passing year", "Account", "Academics"]} empty={rows.length === 0 ? <EmptyState title="No students found">{anyFilter ? "Try different filters." : "Add a student or import a CSV to get started."}</EmptyState> : undefined}>
        {rows.map((r) => (
          <tr key={r.id}>
            <Td><Link href={`/college/students/${r.id}`} className="font-medium underline">{r.full_name}</Link><span className="block text-xs text-muted">{r.college_email}</span></Td>
            <Td className="font-mono text-xs">{r.register_number}</Td>
            <Td>{r.dept_code}</Td>
            <Td>{r.degree}</Td>
            <Td>{r.passing_year}</Td>
            <Td><StatusBadge value={r.account_status} label={r.account_status === "NOT_INVITED" ? "Not invited" : undefined} /></Td>
            <Td><StatusBadge value={({ VERIFIED: "APPROVED", PENDING: "PENDING", REJECTED: "REJECTED", NOT_SUBMITTED: "NOT_STARTED" } as Record<string, string>)[r.academic_status]} label={ACADEMIC_LABEL[r.academic_status] + (r.update_pending ? " · update pending" : "")} /></Td>
          </tr>
        ))}
      </Table>
      <Pagination page={filters.page} total={total} basePath="/college/students" params={{ q, dept, year, account, academics }} />

      <Card title="Invite students">
        <BulkInvite q={q} dept={dept} year={year} eligible={invitable.total} />
      </Card>
    </div>
  );
}

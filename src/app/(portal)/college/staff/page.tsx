import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { Card } from "@/components/ui/card";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { Select } from "@/components/ui/select";
import { StatusBadge, humanize } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { revokeInvitationAction } from "@/server/college/actions";
import { listStaff } from "@/server/college/queries";
import { InviteStaffForm } from "./invite-form";

export const metadata = { title: "Staff — CampusConnect" };

const ROLE_LABEL: Record<string, string> = { COLLEGE_ADMIN: "College administrator", PLACEMENT_OFFICER: "Placement officer", COORDINATOR: "Coordinator" };

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ q?: string; role?: string; status?: string; page?: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 100) || undefined;
  const role = ["COLLEGE_ADMIN", "PLACEMENT_OFFICER", "COORDINATOR"].includes(sp.role ?? "") ? sp.role : undefined;
  const status = sp.status === "ACTIVE" || sp.status === "DISABLED" ? sp.status : undefined;
  const page = parsePage(sp.page);
  const { rows, total, pending } = await listStaff(s, { q, role, status, page });
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Staff</h1>

      <form className="flex flex-wrap items-end gap-3" role="search">
        <div className="space-y-1">
          <label htmlFor="q" className="block text-sm font-medium">Search</label>
          <input id="q" name="q" defaultValue={q} placeholder="Name or email" className="h-10 w-60 max-w-full rounded-md border border-border bg-surface px-3 text-sm" />
        </div>
        <Select id="filter-role" name="role" label="Role" defaultValue={role ?? ""}>
          <option value="">All roles</option>
          {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select id="filter-status" name="status" label="Status" defaultValue={status ?? ""}>
          <option value="">Any</option><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option>
        </Select>
        <button className="h-10 rounded-md border border-border bg-surface px-4 text-sm hover:bg-background">Apply filters</button>
        {q || role || status ? <Link href="/college/staff" className="inline-flex h-10 items-center text-sm underline">Clear</Link> : null}
      </form>

      <Table head={["Name", "Role", "Departments", "Status", "Last sign-in"]} empty={rows.length === 0 ? <EmptyState title="No staff found">{q || role || status ? "Try different filters." : "Invite staff below."}</EmptyState> : undefined}>
        {rows.map((u) => (
          <tr key={u.id}>
            <Td><Link href={`/college/staff/${u.id}`} className="font-medium underline">{u.full_name}</Link><span className="block text-xs text-muted">{u.email}</span></Td>
            <Td>{ROLE_LABEL[u.role] ?? humanize(u.role)}</Td>
            <Td>{u.role === "COORDINATOR" ? (u.departments.length ? u.departments.join(", ") : <span className="text-muted">None</span>) : <span className="text-muted">—</span>}</Td>
            <Td><StatusBadge value={u.status} /></Td>
            <Td>{fmtDateTime(u.last_login_at)}</Td>
          </tr>
        ))}
      </Table>
      <Pagination page={page} total={total} basePath="/college/staff" params={{ q, role, status }} />

      <Card title="Pending invitations">
        {pending.length === 0 ? <p className="text-sm text-muted">No pending invitations.</p> : (
          <ul className="divide-y divide-border">
            {pending.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <span><span className="font-medium">{i.email}</span> <span className="text-muted">· {ROLE_LABEL[i.role]} · expires {fmtDateTime(i.expires_at)}</span></span>
                <ActionButton action={revokeInvitationAction} fields={{ id: i.id }} label="Revoke" pendingLabel="Revoking…" small />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Invite staff"><InviteStaffForm /></Card>
    </div>
  );
}

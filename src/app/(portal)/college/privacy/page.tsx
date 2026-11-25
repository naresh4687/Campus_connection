import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { erasureList } from "@/server/privacy/queries";
import { DecideForms, RetryForm } from "./decide-forms";

export const metadata = { title: "Data requests — CampusConnect" };

export default async function DataRequestsPage() {
  const s = await requireRole("COLLEGE_ADMIN");
  const rows = await erasureList(s);
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Data requests</h1>
      <p className="text-sm text-muted">Students asking for their account and personal data to be deleted. Check first whether the college must keep any of it (for example an open placement process).</p>
      {rows.length === 0 ? <EmptyState title="No requests">Nothing is waiting for you.</EmptyState> : rows.map((r) => (
        <Card key={r.id} title={r.status === "ERASED" ? "Erased student" : `${r.full_name} · ${r.register_number}`}>
          <div className="space-y-3 text-sm">
            <p className="text-muted">Asked {fmtDateTime(r.requested_at)}{r.decided_at ? ` · ${r.status === "ERASED" ? "erased" : "declined"} ${fmtDateTime(r.decided_at)} by ${r.decided_by_name}` : ""}</p>
            {r.status === "PENDING" ? <DecideForms id={r.id} name={r.full_name} /> : null}
            {r.files_left > 0 ? <><p>{r.files_left} uploaded file{r.files_left === 1 ? " is" : "s are"} still in storage.</p><RetryForm id={r.id} /></> : null}
          </div>
        </Card>
      ))}
    </div>
  );
}

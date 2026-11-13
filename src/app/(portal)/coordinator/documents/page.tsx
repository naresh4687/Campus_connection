import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { DocumentItem } from "@/components/ui/document-list";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/table";
import { requireRole } from "@/server/auth/session";
import { pendingDocuments } from "@/server/documents/queries";
import { DocReviewForm } from "./doc-review-form";

export const metadata = { title: "Documents to review — CampusConnect" };

export default async function CoordinatorDocuments({ searchParams }: { searchParams: Promise<{ page?: string; notice?: string }> }) {
  const s = await requireRole("COORDINATOR");
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { rows, total } = await pendingDocuments(s, page);
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Documents to review</h1>
      <p className="text-sm text-muted">Mark sheets, certificates and other documents uploaded by students of your departments, oldest first. Opening a document is recorded and visible to the student. Résumés are private to the student and never appear here.</p>
      {sp.notice === "verified" ? <Alert kind="success">Document verified.</Alert> : null}
      {sp.notice === "rejected" ? <Alert kind="success">Document rejected. The student can see your reason.</Alert> : null}
      {rows.length === 0 ? <div className="rounded-lg border border-border bg-surface"><EmptyState title="Nothing to review">New uploads from your students will appear here.</EmptyState></div> : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-surface px-4" aria-label="Pending documents">
          {rows.map((d) => (
            <div key={d.id}>
              <p className="pt-3 text-sm"><Link href={`/coordinator/students/${d.student_id}`} className="font-medium underline">{d.student_name}</Link> <span className="font-mono text-xs text-muted">{d.register_number} · {d.dept_code}</span></p>
              <DocumentItem doc={d} showAccess actions={<DocReviewForm id={d.id} backTo="/coordinator/documents" />} />
            </div>
          ))}
        </ul>
      )}
      <Pagination page={page} total={total} basePath="/coordinator/documents" params={{}} />
    </div>
  );
}

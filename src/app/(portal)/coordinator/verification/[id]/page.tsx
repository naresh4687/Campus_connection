import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { HistoryItem, SubmissionValuesView } from "@/components/ui/submission-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { SUBMISSION_LABEL } from "@/lib/academics";
import { fmtDateTime } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getSubmission } from "@/server/academics/queries";
import { evidenceFor, documentsFor } from "@/server/documents/queries";
import { DocumentItem } from "@/components/ui/document-list";
import { DocReviewForm } from "../../documents/doc-review-form";
import { ReviewForms } from "./review-form";

export const metadata = { title: "Review — CampusConnect" };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("COORDINATOR");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const d = await getSubmission(s, id); // a submission of a student outside this coordinator's departments does not exist for them (RLS) -> 404
  if (!d) notFound();
  const { submission: a, student: st, others } = d;
  const tone = { SUBMITTED: "PENDING", VERIFIED: "APPROVED", REJECTED: "REJECTED", SUPERSEDED: "NOT_STARTED", WITHDRAWN: "NOT_STARTED" }[a.status];
  const verified = others.find((o) => o.status === "VERIFIED");
  const links = (await evidenceFor(s, [a.id])).get(a.id) ?? [];
  const { docs: allDocs, events } = await documentsFor(s, st.id);
  const evidenceDocs = allDocs.filter((d) => links.some((l) => l.id === d.id));
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/coordinator/verification" className="underline">← Verification queue</Link></p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{st.full_name}</h1>
        <span className="font-mono text-sm text-muted">{st.register_number}</span>
        <StatusBadge value={tone ?? "NOT_STARTED"} label={SUBMISSION_LABEL[a.status]} />
      </div>

      <Card title="Student (set by the college)">
        <dl className="grid grid-cols-[11rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Department</dt><dd>{st.dept_code} — {st.dept_name}</dd>
          <dt className="text-muted">Degree</dt><dd>{st.degree}</dd>
          <dt className="text-muted">Batch</dt><dd>{st.admission_year} – {st.passing_year}</dd>
          <dt className="text-muted">College email</dt><dd>{st.college_email}</dd>
        </dl>
      </Card>

      <Card title={`Submitted values — version ${a.version}`}>
        <SubmissionValuesView s={a} />
        <p className="mt-3 text-xs text-muted">Submitted {fmtDateTime(a.submitted_at)}.</p>
      </Card>

      {verified && a.status === "SUBMITTED" ? (
        <Card title="Currently verified record (will be replaced if you verify this update)"><SubmissionValuesView s={verified} /></Card>
      ) : null}

      <Card title="Evidence attached by the student">
        {evidenceDocs.length === 0 ? <p className="text-sm text-muted">No documents were attached to this submission. You can still verify against college records, or reject and ask for evidence.</p> : (
          <ul className="divide-y divide-border" aria-label="Evidence">
            {evidenceDocs.map((d) => <DocumentItem key={d.id} doc={d} events={events.get(d.id)} showAccess actions={d.review_status === "PENDING" ? <DocReviewForm id={d.id} /> : undefined} />)}
          </ul>
        )}
        <p className="mt-2 text-xs text-muted">Opening a document is recorded and visible to the student.</p>
      </Card>

      <Card title="Decision"><ReviewForms id={a.id} pending={a.status === "SUBMITTED"} /></Card>

      {others.length > 0 ? (
        <Card title="Other versions"><ul className="divide-y divide-border">{others.map((o) => <HistoryItem key={o.id} s={o} />)}</ul></Card>
      ) : null}
      {a.status !== "SUBMITTED" ? <Card title="This version"><ul><HistoryItem s={a} /></ul></Card> : null}
    </div>
  );
}

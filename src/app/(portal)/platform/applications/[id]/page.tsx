import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { COLLEGE_TYPES } from "@/lib/india";
import { fmtDateTime } from "@/lib/format";
import { safeHref, uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getApplication } from "@/server/platform/queries";
import { ReviewActions } from "./review-actions";

export const metadata = { title: "Application — CampusConnect" };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("PLATFORM_SUPER_ADMIN");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const a = await getApplication(s, id);
  if (!a) notFound();
  const href = safeHref(a.website);
  const type = COLLEGE_TYPES.find((t) => t.value === a.college_type)?.label ?? a.college_type;
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/platform/applications" className="underline">← Applications</Link></p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{a.name}</h1>
        <StatusBadge value={a.status} />
      </div>

      <Card title="Applicant details">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Official email</dt><dd>{a.official_email}</dd>
          <dt className="text-muted">Contact person</dt><dd>{a.contact_person}</dd>
          <dt className="text-muted">Phone</dt><dd>{a.phone}</dd>
          <dt className="text-muted">Address</dt><dd>{a.address}, {a.district}, {a.state}</dd>
          <dt className="text-muted">Website</dt>
          <dd>{href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">{a.website}</a> : <span>{a.website} (not a web link)</span>}</dd>
          <dt className="text-muted">College type</dt><dd>{type}</dd>
          <dt className="text-muted">Student strength</dt><dd>{a.approx_students.toLocaleString("en-IN")}</dd>
        </dl>
      </Card>

      <Card title="Timeline">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Submitted</dt><dd>{fmtDateTime(a.submitted_at)}</dd>
          <dt className="text-muted">Review started</dt><dd>{fmtDateTime(a.review_started_at)}</dd>
          <dt className="text-muted">Decided</dt><dd>{fmtDateTime(a.decided_at)}{a.reviewer_email && a.decided_at ? ` by ${a.reviewer_email}` : ""}</dd>
          {a.decision_reason ? (<><dt className="text-muted">Reason</dt><dd className="whitespace-pre-wrap">{a.decision_reason}</dd></>) : null}
        </dl>
      </Card>

      <Card title="Decision">
        <ReviewActions id={a.id} status={a.status} officialEmail={a.official_email} collegeId={a.college_id} />
      </Card>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { HistoryItem, SubmissionValuesView } from "@/components/ui/submission-view";
import { fmtDateTime } from "@/lib/format";
import { submissionsFor } from "@/server/academics/queries";
import { CompletionChecklist } from "@/components/students/completion-card";
import { completionFor } from "@/server/students/queries";
import { achievementsFor } from "@/server/achievements/queries";
import { AchievementList } from "@/components/students/achievement-list";
import { documentsFor } from "@/server/documents/queries";
import { DocumentItem } from "@/components/ui/document-list";
import { DocReviewForm } from "../../documents/doc-review-form";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { careerCategories, careerHistory, driveHistory, getStudent } from "@/server/students/queries";
import { DriveHistory } from "@/components/students/drive-history";
import { CareerForm } from "@/components/students/career-form";
import { CareerPanel } from "@/components/students/career-panel";

export const metadata = { title: "Student — CampusConnect" };

export default async function CoordinatorStudent({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("COORDINATOR");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const st = await getStudent(s, id); // a student outside this coordinator's departments simply does not exist for them (RLS) -> 404
  if (!st) notFound();
  const [categories, history] = await Promise.all([careerCategories(s), careerHistory(s, id)]);
  const subs = await submissionsFor(s, id);
  const achievements = await achievementsFor(s, id);
  const completion = await completionFor(s, id);
  const drives = await driveHistory(s, id);
  const { docs, events } = await documentsFor(s, id);
  const verified = subs.find((x) => x.status === "VERIFIED");
  const open = subs.find((x) => x.status === "SUBMITTED");
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/coordinator/students" className="underline">← Department students</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">{st.full_name}</h1>
      <Card title="Career interest">
        <CareerPanel current={st.career_preference} categories={categories} history={history}>
          <CareerForm categories={categories} formId="career-one" studentId={st.id} current={st.career_preference} />
        </CareerPanel>
      </Card>
      <Card title="Student record">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Register number</dt><dd className="font-mono">{st.register_number}</dd>
          <dt className="text-muted">Department</dt><dd>{st.dept_code} — {st.dept_name}</dd>
          <dt className="text-muted">Degree</dt><dd>{st.degree}{st.specialization ? ` · ${st.specialization}` : ""}</dd>
          <dt className="text-muted">Batch</dt><dd>{st.admission_year} – {st.passing_year}</dd>
          <dt className="text-muted">College email</dt><dd>{st.college_email}</dd>
          <dt className="text-muted">Personal email</dt><dd>{st.personal_email ?? "—"}</dd>
          <dt className="text-muted">Phone</dt><dd>{st.phone ?? "—"}</dd>
          <dt className="text-muted">Has an account</dt><dd>{st.has_account ? "Yes" : "No"}</dd>
        </dl>
        <p className="mt-3 text-xs text-muted">Read-only. Identity details are managed by your college administrator; academic records and verification arrive with the next module.</p>
      </Card>
    
      <Card title="Documents">
        {docs.length === 0 ? <p className="text-sm text-muted">No mark sheets or certificates visible. (Résumés are private to the student.)</p> : (
          <ul className="divide-y divide-border" aria-label="Student documents">{docs.map((d) => <DocumentItem key={d.id} doc={d} events={events.get(d.id)} showAccess actions={d.review_status === "PENDING" ? <DocReviewForm id={d.id} /> : undefined} />)}</ul>
        )}
        <p className="mt-2 text-xs text-muted">Opening a document is recorded and visible to the student.</p>
      </Card>

      {completion ? <Card title="Profile completion"><CompletionChecklist flags={completion} score={completion.score} forStudent={false} /></Card> : null}

      <Card title="Achievements">
        <AchievementList items={achievements} />
        <p className="mt-2 text-xs text-muted">Only entries marked verified have been confirmed by a coordinator.</p>
      </Card>

      <Card title="Drive history and placement"><DriveHistory rows={drives} /></Card>

      <Card title="Academic record">
        {verified ? (<><SubmissionValuesView s={verified} /><p className="mt-3 text-xs text-muted">Verified by {verified.reviewed_by_name} on {fmtDateTime(verified.reviewed_at)}.</p></>) : <p className="text-sm text-muted">No verified academic record yet.</p>}
        {open ? <p className="mt-3 text-sm">A submission (version {open.version}) is awaiting review · <Link className="underline" href={`/coordinator/verification/${open.id}`}>review it</Link>.</p> : null}
        {subs.length > 0 ? <details className="mt-4"><summary className="cursor-pointer text-sm underline">Submission history ({subs.length})</summary><ul className="mt-2 divide-y divide-border" aria-label="Submission history">{subs.map((x) => <HistoryItem key={x.id} s={x} />)}</ul></details> : null}
      </Card>
    </div>
  );
}

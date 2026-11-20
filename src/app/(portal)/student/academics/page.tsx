import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { HistoryItem, SubmissionValuesView } from "@/components/ui/submission-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACADEMIC_LABEL } from "@/lib/academics";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { myAcademicStatus, mySubmissions } from "@/server/academics/queries";
import { myStudentRecord } from "@/server/students/queries";
import { evidenceChoices, evidenceFor } from "@/server/documents/queries";
import { downloadHref } from "@/components/ui/document-list";
import { AcademicForm, type AcademicValues } from "./academic-form";
import { WithdrawButton } from "./withdraw-button";

export const metadata = { title: "Academic records — CampusConnect" };

export default async function StudentAcademics({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const { notice } = await searchParams;
  const s = await requireRole("STUDENT");
  const [st, subs, status, choices] = await Promise.all([myStudentRecord(s), mySubmissions(s), myAcademicStatus(s), evidenceChoices(s)]);
  const evidence = await evidenceFor(s, subs.map((x) => x.id));
  const evidenceList = (id: string) => (evidence.get(id) ?? []).length ? (<p className="mt-3 text-sm">Evidence: {(evidence.get(id) ?? []).map((d, i) => <span key={d.id}>{i ? ", " : ""}<a href={downloadHref(d.id)} className="underline">{d.original_name}</a></span>)}</p>) : null;
  const verified = subs.find((x) => x.status === "VERIFIED");
  const open = subs.find((x) => x.status === "SUBMITTED");
  const latestRejected = !open && !verified ? subs.find((x) => x.status === "REJECTED") : undefined;
  // Prefill from the current truth: a verified record wins over an older rejection; with nothing verified, correct the latest rejection.
  const base = open ?? verified ?? subs.find((x) => x.status === "REJECTED") ?? subs[0];
  const initial: AcademicValues = base
    ? { cgpa: Number(base.cgpa).toFixed(2), tenth: Number(base.tenth_percentage).toFixed(2), twelfth: base.twelfth_percentage === null ? "" : Number(base.twelfth_percentage).toFixed(2),
        diploma: base.diploma_percentage === null ? "" : Number(base.diploma_percentage).toFixed(2), backlogs: String(base.active_backlogs), arrears: String(base.historical_arrears), note: "" }
    : { cgpa: "", tenth: "", twelfth: "", diploma: "", backlogs: "", arrears: "", note: "" };
  for (const r of base?.semesters ?? []) { initial[`sem${r.semester}_sgpa`] = Number(r.sgpa).toFixed(2); initial[`sem${r.semester}_backlogs`] = String(r.backlogs); }
  const tone = { VERIFIED: "APPROVED", PENDING: "PENDING", REJECTED: "REJECTED", NOT_SUBMITTED: "NOT_STARTED" }[status.status];
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Academic records</h1>
        <StatusBadge value={tone ?? "NOT_STARTED"} label={ACADEMIC_LABEL[status.status]} />
        {status.update_pending ? <StatusBadge value="PENDING" label="Update awaiting review" /> : null}
      </div>
      {notice === "submitted" ? <Alert kind="success">Submitted for review. A coordinator of your department will verify it.</Alert> : null}
      {notice === "withdrawn" ? <Alert kind="success">Submission withdrawn.</Alert> : null}
      {st ? <p className="text-sm text-muted">{st.degree} · {st.dept_code} — {st.dept_name} · passing year {st.passing_year}. These details are set by your college.</p> : null}

      {latestRejected ? (
        <Alert kind="error"><strong>Your last submission was rejected.</strong> Reason: <span className="whitespace-pre-wrap">{latestRejected.rejection_reason}</span> Correct the values below and submit again.</Alert>
      ) : null}

      {verified ? (
        <Card title="Verified record">
          <SubmissionValuesView s={verified} />
          {evidenceList(verified.id)}
          <p className="mt-3 text-xs text-muted">Verified by {verified.reviewed_by_name} on {fmtDateTime(verified.reviewed_at)}. This is the record used for eligibility.</p>
        </Card>
      ) : null}

      {open ? (
        <Card title="Awaiting review">
          <SubmissionValuesView s={open} />
          {evidenceList(open.id)}
          <p className="mt-3 text-sm text-muted">Submitted {fmtDateTime(open.submitted_at)}. You can’t edit a submission while it is being reviewed; withdraw it if you need to change something.</p>
          <div className="mt-3"><WithdrawButton id={open.id} /></div>
        </Card>
      ) : (
        <Card title={verified ? "Update your record" : "Submit your academic details"}>
          {verified ? <p className="mb-4 text-sm text-muted">Changing verified details sends a new submission for review. Your current verified record stays in force until the update is verified.</p> : <p className="mb-4 text-sm text-muted">Enter your details exactly as on your mark sheets. A coordinator of your department will verify them against college records.</p>}
          <AcademicForm initial={initial} updating={Boolean(verified)} evidence={choices} />
        </Card>
      )}

      <Card title="History">
        {subs.length === 0 ? <p className="text-sm text-muted">Nothing submitted yet.</p> : <ul className="divide-y divide-border" aria-label="Submission history">{subs.map((x) => <HistoryItem key={x.id} s={x} />)}</ul>}
      </Card>
    </div>
  );
}

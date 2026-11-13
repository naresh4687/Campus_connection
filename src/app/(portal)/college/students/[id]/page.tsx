import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ui/action-button";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { HistoryItem, SubmissionValuesView } from "@/components/ui/submission-view";
import { submissionsFor } from "@/server/academics/queries";
import { fmtDateTime } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { issueResetLinkAction, setStaffStatusAction } from "@/server/college/actions";
import { inviteStudentAction } from "@/server/students/actions";
import { activeDepartments, getStudent } from "@/server/students/queries";
import { StudentForm } from "../student-form";

export const metadata = { title: "Student — CampusConnect" };

export default async function StudentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const { id } = await params;
  const { created } = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const st = await getStudent(s, id);
  if (!st) notFound();
  const depts = await activeDepartments(s);
  const subs = await submissionsFor(s, id);
  const verified = subs.find((x) => x.status === "VERIFIED");
  const open = subs.find((x) => x.status === "SUBMITTED");
  const status = st.user_status === "DISABLED" ? "DISABLED" : st.has_account ? "ACTIVE" : st.invite_expires ? "INVITED" : "NOT_INVITED";
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/college/students" className="underline">← Students</Link></p>
      {created ? <Alert kind="success">Student added. Invite them below so they can sign in.</Alert> : null}
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{st.full_name}</h1>
        <span className="font-mono text-sm text-muted">{st.register_number}</span>
        <StatusBadge value={status} label={status === "NOT_INVITED" ? "Not invited" : undefined} />
      </div>

      <Card title="Account">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Sign-in email</dt><dd>{st.college_email}</dd>
          <dt className="text-muted">Last sign-in</dt><dd>{st.has_account ? fmtDateTime(st.last_login_at) : "—"}</dd>
          {st.invite_expires ? (<><dt className="text-muted">Invitation</dt><dd>pending until {fmtDateTime(st.invite_expires)}</dd></>) : null}
        </dl>
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          {!st.has_account ? (
            <div>
              <p className="mb-2 text-sm text-muted">{st.invite_expires ? "A newer invitation replaces the pending one, which then stops working." : "Create a one-time link for this student to set a password. Send it to them yourself (email delivery is not enabled)."}</p>
              <ActionButton action={inviteStudentAction} fields={{ id: st.id, email: st.college_email }} label={st.invite_expires ? "Create a new invitation" : "Create invitation"} variant="primary" pendingLabel="Creating…" linkTitle="One-time student invitation" />
            </div>
          ) : st.user_id ? (
            <div className="space-y-4">
              <div>
                <p className="mb-2 text-sm text-muted">{st.user_status === "DISABLED" ? "This account is disabled and cannot sign in." : "Disabling signs the student out immediately. It can be reversed."}</p>
                <ActionButton action={setStaffStatusAction} fields={{ id: st.user_id, status: st.user_status === "DISABLED" ? "ACTIVE" : "DISABLED" }} label={st.user_status === "DISABLED" ? "Enable account" : "Disable account"} variant={st.user_status === "DISABLED" ? "primary" : "danger"} pendingLabel="Saving…" />
              </div>
              {st.user_status !== "DISABLED" ? (
                <div>
                  <p className="mb-2 text-sm text-muted">Create a one-time link that lets the student choose a new password. It signs them out of all sessions when used.</p>
                  <ActionButton action={issueResetLinkAction} fields={{ id: st.user_id, email: st.college_email }} label="Create password reset link" pendingLabel="Creating…" linkTitle="One-time password reset link" />
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </Card>


      <Card title="Academic record">
        {verified ? (<><SubmissionValuesView s={verified} /><p className="mt-3 text-xs text-muted">Verified by {verified.reviewed_by_name} on {fmtDateTime(verified.reviewed_at)}.</p></>) : <p className="text-sm text-muted">No verified academic record yet.</p>}
        {open ? <p className="mt-3 text-sm">A submission (version {open.version}) is awaiting review.</p> : null}
        {subs.length > 0 ? <details className="mt-4"><summary className="cursor-pointer text-sm underline">Submission history ({subs.length})</summary><ul className="mt-2 divide-y divide-border" aria-label="Submission history">{subs.map((x) => <HistoryItem key={x.id} s={x} />)}</ul></details> : null}
      </Card>

      <Card title="Details">
        <StudentForm id={st.id} emailLocked={st.has_account} departments={depts}
          initial={{ departmentId: st.department_id, registerNumber: st.register_number, fullName: st.full_name, collegeEmail: st.college_email, personalEmail: st.personal_email ?? "", phone: st.phone ?? "",
                     degree: st.degree, specialization: st.specialization ?? "", admissionYear: String(st.admission_year), passingYear: String(st.passing_year) }} />
        <p className="mt-4 text-xs text-muted">Added {fmtDateTime(st.created_at)} · last changed {fmtDateTime(st.updated_at)}{st.import_id ? " · created by CSV import" : ""}</p>
      </Card>
    </div>
  );
}

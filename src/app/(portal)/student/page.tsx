import { Donut } from "@/components/charts/charts";
import { DashCard, DeadlineCard, Gauge, MiniStat, Pill, Pipeline, PersonList } from "@/components/dashboard/kit";
import { PageHeader, PanelLink } from "@/components/ui/metrics";
import { registrationView } from "@/lib/evidence";
import { NextSteps } from "@/components/ui/next-steps";
import { StatusBadge } from "@/components/ui/status-badge";
import { ACADEMIC_LABEL } from "@/lib/academics";
import { requireRole } from "@/server/auth/session";
import { myAcademicStatus } from "@/server/academics/queries";
import { completionFor, myStudentRecord } from "@/server/students/queries";
import { CompletionChecklist } from "@/components/students/completion-card";
import { myDrives } from "@/server/registrations/queries";
import { myOffers } from "@/server/offers/queries";
import { fmtDate, fmtDateTime } from "@/lib/format";

export const metadata = { title: "Student dashboard — CampusConnect" };

const CTA: Record<string, string> = {
  NOT_SUBMITTED: "Submit your academic details so a coordinator can verify them. You need a verified record before you can register for placement drives.",
  PENDING: "Your academic details are with a coordinator for review.",
  VERIFIED: "Your academic record is verified.",
  REJECTED: "Your last submission was rejected. Open Academics to see the reason and submit a correction.",
};

export default async function StudentHome() {
  const s = await requireRole("STUDENT");
  const [st, ac, drives, offers, completion] = await Promise.all([myStudentRecord(s), myAcademicStatus(s), myDrives(s), myOffers(s), completionFor(s)]);
  const now = new Date();
  const openDrives = drives.filter((d) => d.status === "PUBLISHED" && d.application_deadline && new Date(d.application_deadline) > now);
  const canRegister = openDrives.filter((d) => d.result === "ELIGIBLE" && d.registration_status !== "REGISTERED");
  const registered = drives.filter((d) => d.registration_status === "REGISTERED");
  const needsScreenshot = drives.filter((d) => d.method === "EXTERNAL" && (d.registration_status === "PENDING_EXTERNAL" || d.evidence_status === "REJECTED" || d.evidence_status === "RESUBMISSION_REQUIRED"));
  const awaiting = offers.filter((o) => o.offer_status === "ISSUED" && o.response_deadline && new Date(o.response_deadline) > now).sort((a, b) => +new Date(a.response_deadline!) - +new Date(b.response_deadline!));
  const tone = { VERIFIED: "APPROVED", PENDING: "PENDING", REJECTED: "REJECTED", NOT_SUBMITTED: "NOT_STARTED" }[ac.status];
  // Drives that need the student's action, soonest deadline first: eligible and not registered, or an external registration that still needs its screenshot.
  const action = openDrives
    .filter((d) => (d.result === "ELIGIBLE" && d.registration_status !== "REGISTERED") || d.registration_status === "PENDING_EXTERNAL")
    .sort((a, b) => +new Date(a.application_deadline!) - +new Date(b.application_deadline!));
  const daysLeft = (iso: Date) => Math.max(0, Math.ceil((new Date(iso).getTime() - now.getTime()) / 86400_000));
  const today = new Date().toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
  const upcoming = [...drives].filter((d) => d.status === "PUBLISHED").sort((a, b) => +new Date(a.application_deadline ?? 0) - +new Date(b.application_deadline ?? 0)).slice(0, 5);
  return (
    <div className="space-y-6">
      <PageHeader title="Student dashboard" description={`Welcome, ${s.fullName}.`} actions={<><Pill>{today}</Pill><Pill href="/student/drives">Drives</Pill></>} />
      <section aria-labelledby="act" className="space-y-3">
        <h2 id="act">{action.length ? `Open for you: ${action.length} drive${action.length === 1 ? "" : "s"} to act on` : "Open for you"}</h2>
        {action.length === 0 ? <p className="card p-4 text-sm text-muted">You are all caught up: there is no open drive waiting for your registration.</p> : (
          <ul className="grid grid-cols-1 gap-4 @3xl:grid-cols-2 @6xl:grid-cols-3" aria-label="Drives waiting for you">
            {action.slice(0, 6).map((d) => <DeadlineCard key={d.id} company={d.company_name} job={d.job_title} daysLeft={daysLeft(d.application_deadline!)} deadline={fmtDate(d.application_deadline)} href={`/student/drives/${d.id}`}
              state={d.registration_status === "PENDING_EXTERNAL" ? "Started: screenshot still needed" : "Not registered yet"} cta={d.registration_status === "PENDING_EXTERNAL" ? "Finish registration" : "View and register"} />)}
          </ul>)}
      </section>
      <NextSteps items={[
        ...needsScreenshot.map((d) => ({ text: d.registration_status === "PENDING_EXTERNAL" ? `Finish your registration for ${d.company_name}: upload the confirmation screenshot.` : `Upload a new registration screenshot for ${d.company_name}.`, href: `/student/drives/${d.id}` })),
        ...awaiting.map((o) => ({ text: `Respond to your offer from ${o.company_name} by ${fmtDateTime(o.response_deadline)}.`, href: `/student/offers/${o.id}` })),
        ...(canRegister.length > 0 ? [{ text: `${canRegister.length} open drive${canRegister.length === 1 ? "" : "s"} you are eligible for and have not registered for.`, href: "/student/drives" }] : []),
      ]} />

      <div className="grid grid-cols-1 gap-6 @5xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-6">
          <DashCard title="Your placement journey" icon="briefcase" id="journey" action={<PanelLink href="/student/drives">Browse placement drives</PanelLink>}>
            <Pipeline ids label="Your placement activity" stages={[
              { label: "Profile complete", value: completion?.score ?? 0, icon: "users", note: "percent" },
              { label: "Academics verified", value: ac.status === "VERIFIED" ? 1 : 0, icon: "shield", note: ACADEMIC_LABEL[ac.status] },
              { label: "Open drives", value: openDrives.length, icon: "briefcase" },
              { label: "Registered", value: registered.length, icon: "check" },
              { label: "Offers", value: offers.length, icon: "file", note: awaiting.length ? `${awaiting.length} awaiting your answer` : undefined }]} />
          </DashCard>
          <DashCard title="Drives" icon="calendar" id="drives" action={<PanelLink href="/student/drives">All drives</PanelLink>}>
            <PersonList empty="No drive has been published for you yet." rows={upcoming.map((d) => { const v = registrationView({ status: d.registration_status, method: d.method, evidence_status: d.evidence_status }); return { key: d.id, name: d.company_name, sub: d.job_title, meta: d.application_deadline ? `Apply by ${fmtDate(d.application_deadline)}` : undefined, right: <StatusBadge value={v.tone} label={v.label} /> }; })} />
          </DashCard>
        </div>
        <div className="min-w-0 space-y-6">
          <DashCard title="Your overview" icon="chart" id="over">
            <Gauge title="Profile completion" value={completion?.score ?? 0} of={100} caption="profile complete" link={<PanelLink href="/student/profile">Profile</PanelLink>} />
            <div className="mt-4 grid grid-cols-3 gap-2.5">
              <MiniStat icon="briefcase" label="Open drives" value={openDrives.length} href="/student/drives" />
              <MiniStat icon="check" label="Registered" value={registered.length} href="/student/drives" />
              <MiniStat icon="file" label="Offers" value={offers.length} href="/student/offers" />
            </div>
          </DashCard>
          <DashCard title="Where you stand" icon="chart" id="stand">
            <Donut title="Open drives" unit="open drives" empty="No drive is open for registration right now." slices={[
              { label: "Registered", value: openDrives.filter((d) => d.registration_status === "REGISTERED").length, tone: "ink" },
              { label: "Eligible, not registered", value: canRegister.length, tone: "amber" },
              { label: "Needs verified data", value: openDrives.filter((d) => d.result === "NEEDS_DATA" && d.registration_status !== "REGISTERED").length, tone: "grey" },
              { label: "Not eligible", value: openDrives.filter((d) => d.result === "NOT_ELIGIBLE" && d.registration_status !== "REGISTERED").length, tone: "red" }]} />
          </DashCard>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 @4xl:grid-cols-2">
        <DashCard title="Academic verification" icon="shield" id="av" action={<PanelLink href="/student/academics">Open Academics</PanelLink>}>
          <p className="flex flex-wrap items-center gap-2 text-sm"><StatusBadge value={tone ?? "NOT_STARTED"} label={ACADEMIC_LABEL[ac.status]} />{ac.update_pending ? <StatusBadge value="PENDING" label="Update awaiting review" /> : null}</p>
          <p className="mt-3 text-sm text-muted">{CTA[ac.status]}</p>
        </DashCard>
        <DashCard title="Your record" icon="users" id="rec" action={st ? <PanelLink href="/student/profile">View or update your profile</PanelLink> : undefined}>
          {st ? (
            <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
              <div><dt className="text-muted">Degree</dt><dd className="mt-0.5 font-semibold">{st.degree}</dd></div>
              <div><dt className="text-muted">Department</dt><dd className="mt-0.5 font-semibold">{st.dept_name}</dd></div>
              <div><dt className="text-muted">Register number</dt><dd className="mt-0.5 font-semibold tabular-nums">{st.register_number}</dd></div>
              <div><dt className="text-muted">Batch</dt><dd className="mt-0.5 font-semibold tabular-nums">{st.admission_year}–{st.passing_year}</dd></div>
            </dl>
          ) : <p className="text-sm text-muted">Your student record is not linked yet. Please contact your college administrator.</p>}
        </DashCard>
      </div>
      {completion ? <DashCard title="Profile completion" icon="check" id="pc"><CompletionChecklist flags={completion} score={completion.score} forStudent /></DashCard> : null}
    </div>
  );
}

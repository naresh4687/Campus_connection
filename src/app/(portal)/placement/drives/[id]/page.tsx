import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { DriveView } from "@/components/ui/drive-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { DRIVE_STATUS_LABEL, isoToIstInput } from "@/lib/drives";
import { fmtDateTime } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { driveEvents, driveFormOptions, getDrive } from "@/server/drives/queries";
import { getIntake, intakeOfDrive } from "@/server/intake/queries";
import { classifyLinks } from "@/lib/evidence";
import { externalCounts } from "@/server/registrations/queries";
import { RegistrationMethod } from "../registration-method";
import { ButtonLink } from "@/components/ui/button";
import { ExtendDeadline } from "../extend-deadline";
import { driveCounts } from "@/server/registrations/queries";
import { DriveCountsView } from "@/components/ui/drive-counts";
import { DriveForm } from "../drive-form";
import { Lifecycle } from "../lifecycle";

export const metadata = { title: "Drive — CampusConnect" };
const TONE: Record<string, string> = { DRAFT: "PENDING", PUBLISHED: "APPROVED", CLOSED: "NOT_STARTED", ARCHIVED: "NOT_STARTED" };
const EVENT: Record<string, string> = { CREATED: "Created", UPDATED: "Edited", PUBLISHED: "Published", UNPUBLISHED: "Unpublished", CLOSED: "Closed", ARCHIVED: "Archived" };

const draft0 = (st: string) => st === "DRAFT" || st === "ARCHIVED";

export default async function DrivePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ created?: string; notice?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const { id } = await params;
  const { created, notice } = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getDrive(s, id);
  if (!data) notFound();
  const { drive: d, criteria: c, departments } = data;
  const [events, opts] = await Promise.all([driveEvents(s, id), driveFormOptions(s)]);
  const counts = draft0(d.status) ? null : await driveCounts(s, id);
  const draft = d.status === "DRAFT";
  const intake = draft ? await intakeOfDrive(s, id) : null;
  const reviewHref = intake ? `/placement/drives/ai/${intake}` : null;
  const source = intake ? await getIntake(s, intake) : null;
  const suggestions = source ? classifyLinks(source.source_text) : [];
  const ext = draft0(d.status) ? null : await externalCounts(s, id);
  const locked = !!ext && ext.internal_registered + ext.external_started > 0;
  const initial: Record<string, string> = {
    externalEnabled: d.registration_method === "EXTERNAL" ? "yes" : "", externalUrl: d.external_url ?? "", externalInstructions: d.external_instructions ?? "", externalConfirmed: d.external_url_confirmed ? "yes" : "",
    companyName: d.company_name, title: d.job_title, description: d.job_description ?? "", location: d.location ?? "", type: d.employment_type, ctc: d.ctc_lpa ?? "", ctcNote: d.ctc_note ?? "", bond: d.bond_details ?? "",
    qualification: d.qualification ?? "", openings: d.openings === null ? "" : String(d.openings), deadline: isoToIstInput(d.application_deadline), interview: d.interview_details ?? "", instructions: d.instructions ?? "",
    minCgpa: c.min_cgpa ?? "", minTenth: c.min_tenth ?? "", minTwelfth: c.min_twelfth ?? "", minDiploma: c.min_diploma ?? "", maxBacklogs: c.max_active_backlogs === null ? "" : String(c.max_active_backlogs),
    maxArrears: c.max_historical_arrears === null ? "" : String(c.max_historical_arrears), departments: departments.map((x) => x.id).join(","), years: c.passing_years.join(","), degrees: c.degrees.join(","),
  };
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/placement/drives" className="underline">← Drives</Link></p>
      {notice ? <Alert kind="success">{({ published: `Drive published. ${counts ? counts.eligible : 0} eligible student${counts?.eligible === 1 ? "" : "s"} can register now. Students in the selected departments, passing years and degrees have been notified.`, unpublished: "Drive unpublished. It is a draft again and hidden from students.", closed: "Drive closed.", archived: "Drive archived." } as Record<string, string>)[notice]}</Alert> : null}
      {created ? <Alert kind="success">Draft created. Review it, then publish when it is complete.</Alert> : null}
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{d.job_title}</h1><span className="text-muted">{d.company_name}</span><StatusBadge value={TONE[d.status]} label={DRIVE_STATUS_LABEL[d.status]} /></div>
      <Card title="Status"><Lifecycle id={d.id} status={d.status} reviewHref={reviewHref} />
        <p className="mt-3 text-xs text-muted">{draft ? "A draft is visible only to staff. Publishing locks the content and criteria and makes the drive visible to students." : "Published drives are frozen so every student is judged against the same conditions. To change one, unpublish it back to a draft."}</p></Card>
      {d.status === "PUBLISHED" ? <Card title="Registration deadline"><p className="mb-3 text-sm">Registration {d.application_deadline && new Date(d.application_deadline) > new Date() ? "closes automatically on" : "closed automatically on"} <strong>{fmtDateTime(d.application_deadline)}</strong>.</p><ExtendDeadline id={d.id} expired={!!d.application_deadline && new Date(d.application_deadline) <= new Date()} /></Card> : null}
      {d.status !== "ARCHIVED" && !(draft && !reviewHref) ? (
        <Card title="How students register">
          <RegistrationMethod id={d.id} method={d.registration_method} url={d.external_url ?? ""} instructions={d.external_instructions ?? ""} confirmed={d.external_url_confirmed} review={d.evidence_review_required} locked={locked} suggestions={suggestions} />
        </Card>) : null}
      {ext && d.registration_method === "EXTERNAL" ? (
        <Card title="External registrations">
          <dl className="grid grid-cols-2 gap-3 text-sm" aria-label="External registration counts">
            {([["Started, no screenshot yet", ext.external_started], ["Registered with a screenshot", ext.screenshots_submitted]] as const).map(([k, v]) => <div key={k} className="rounded-xl border border-border p-3"><dt className="text-xs text-muted">{k}</dt><dd className="text-2xl font-semibold" data-testid={`ext-${k}`}>{v}</dd></div>)}
          </dl>
          <p className="mt-3 text-xs text-muted">Counted once per student, however many screenshots they uploaded. A screenshot is kept as proof; nobody has to verify it.</p>
          <p className="mt-2 text-sm"><Link href={`/placement/drives/${d.id}/applicants`} className="underline">See the registered students and their screenshots</Link></p>
        </Card>) : null}
      {counts ? <Card title="Eligibility and registrations"><DriveCountsView c={counts} /><div className="mt-4 flex flex-wrap gap-3" role="group" aria-label="Registration views">
        <ButtonLink href={`/placement/drives/${d.id}/participation`}>Registered and not registered</ButtonLink>
        <ButtonLink href={`/placement/drives/${d.id}/applicants`} variant="secondary">View registered students</ButtonLink>
        <ButtonLink href={`/placement/drives/${d.id}/offers`} variant="secondary">Selections and offers</ButtonLink></div></Card> : null}
      {draft && reviewHref ? <Card title="AI-assisted draft"><p className="text-sm">This draft was made from a company announcement. Edit it, see the original text and publish it on the <Link className="underline" href={reviewHref}>review page</Link>, so your corrections and the checks stay together.</p></Card> : null}
      {draft && !reviewHref ? <Card title="Edit draft"><DriveForm id={d.id} initial={initial} companies={opts.companies.some((x) => x.id === d.company_id) ? opts.companies : [{ id: d.company_id, name: d.company_name }, ...opts.companies]} departments={opts.departments} /></Card> : null}
      <Card title={draft ? "Preview — how students will see it" : "Drive details"}><DriveView drive={d} criteria={c} departments={departments} /></Card>
      <Card title="History"><ul className="space-y-1 text-sm" aria-label="Drive history">{events.map((e, i) => <li key={i}><span className="font-medium">{EVENT[e.event]}</span> by {e.actor_name} <span className="text-muted">· {fmtDateTime(e.occurred_at)}</span></li>)}</ul></Card>
    </div>
  );
}

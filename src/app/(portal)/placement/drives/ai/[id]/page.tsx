import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { DriveView } from "@/components/ui/drive-view";
import { StatusBadge } from "@/components/ui/status-badge";
import { diffExtractions, readiness } from "@/lib/intake/edit";
import { classifyLinks } from "@/lib/evidence";
import { fmtDateTime } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getDrive, driveFormOptions } from "@/server/drives/queries";
import { duplicatesFor, getIntake } from "@/server/intake/queries";
import { DiffPanel, DiscardButton, PublishPanel, ReextractButton, RetryButton } from "./panels";
import { ReviewForm } from "./review-form";

export const metadata = { title: "Review AI draft — CampusConnect" };

export default async function ReviewIntake({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ applied?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const { id } = await params;
  const applied = Number.parseInt((await searchParams).applied ?? "", 10);
  if (!uuidSchema.safeParse(id).success) notFound();
  const rec = await getIntake(s, id);
  if (!rec || rec.status === "DISCARDED") notFound();
  const source = (
    <details open className="card p-4 xl:sticky xl:top-4">
      <summary className="cursor-pointer text-sm font-semibold">Original announcement</summary>
      <p className="mt-1 text-xs text-muted">Submitted {fmtDateTime(rec.submitted_at)} · kept exactly as received. Links in it were not opened.</p>
      <pre tabIndex={0} aria-label="Original announcement text" className="mt-2 max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background p-3 text-xs focus-visible:outline-2 focus-visible:outline-primary">{rec.source_text}</pre>
    </details>
  );
  if (rec.status !== "READY") {
    return (
      <div className="space-y-6">
        <p className="text-sm"><Link href="/placement/drives/new" className="underline">← Create a drive</Link></p>
        <h1 className="text-2xl font-semibold tracking-tight">Announcement saved</h1>
        <Alert kind="error">{rec.error_note ?? "The details have not been extracted yet."}</Alert>
        <div className="grid gap-6 xl:grid-cols-[1fr_24rem]"><Card title="What now?"><div className="space-y-3 text-sm"><RetryButton id={rec.id} /><p>Or <Link href="/placement/drives/new" className="underline">fill the drive in by hand</Link>. Your announcement stays saved here.</p><DiscardButton id={rec.id} /></div></Card>{source}</div>
      </div>
    );
  }
  const opts = await driveFormOptions(s);
  const ctx = { departments: opts.departments };
  const ready = readiness(rec.fields, ctx);
  const drive = rec.drive_id ? await getDrive(s, rec.drive_id) : null;
  const years = rec.fields.passingYears?.status === "EXTRACTED" || rec.fields.passingYears?.human ? (rec.fields.passingYears.value as number[]) : [];
  const dups = await duplicatesFor(s, { company: typeof rec.fields.company?.value === "string" ? rec.fields.company.value : null, title: typeof rec.fields.title?.value === "string" ? rec.fields.title.value : null, years, sourceHash: rec.source_hash, sourceText: rec.source_text, selfIntake: rec.id, selfDrive: rec.drive_id });
  const formLinks = classifyLinks(rec.source_text).filter((l) => l.purpose === "REGISTRATION_FORM");
  const diff = rec.pending ? diffExtractions(rec.fields, rec.pending.fields) : null;
  const locked = !!rec.drive_status && rec.drive_status !== "DRAFT";
  const c = ready.counts;
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/placement/drives" className="underline">← Drives</Link></p>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">Review the AI-assisted draft</h1><StatusBadge value={locked ? "APPROVED" : "PENDING"} label={locked ? `Drive ${rec.drive_status!.toLowerCase()}` : "Draft — not visible to students"} /></div>
      <p className="text-sm text-muted">Read by {rec.provider === "rules" ? "the pattern reader (no AI model)" : `the pattern reader and ${rec.provider} (${rec.model_id})`}. Check every value against the original announcement, correct what is wrong and fill what is missing. Nothing is published until you do it yourself.</p>

      <dl aria-label="Extraction summary" className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        {[["Fields found", c.extracted, "extracted"], ["Need review", c.review, "review"], ["Missing mandatory", c.missingMandatory, "missing"], ["Contradictions", c.contradictions, "contradictions"]].map(([k, v, key]) => (
          <div key={String(key)} className="rounded-xl border border-border bg-surface p-3" data-summary={String(key)}><dt className="text-xs text-muted">{k}</dt><dd className="text-2xl font-semibold">{v}</dd></div>))}
        <div className="rounded-xl border border-border bg-surface p-3" data-summary="validation"><dt className="text-xs text-muted">Validation</dt><dd className="text-sm font-semibold">{ready.ready ? "Ready to publish" : `${ready.errors.length} thing${ready.errors.length === 1 ? "" : "s"} to fix`}</dd></div>
      </dl>

      {Number.isInteger(applied) && applied >= 0 ? <Alert kind="success">{applied ? `${applied} value(s) were replaced with the new reading.` : "No values were replaced."}</Alert> : null}
      {formLinks.length && drive && drive.drive.registration_method === "INTERNAL" && !locked ? (
        <Alert kind="info"><p className="font-medium">This message contains a link that looks like the company’s registration form.</p>
          <p className="mt-1 break-all text-xs">{formLinks[0].url}</p>
          <p className="mt-1">Students currently register in CampusConnect. If they must use the company’s form, choose “External registration” and confirm the link on the <Link className="underline" href={`/placement/drives/${rec.drive_id}`}>drive page</Link> before publishing. A company website or job-description link is not a registration form.</p></Alert>) : null}
      {rec.warnings.map((w, i) => <Alert key={i} kind={w.kind === "INJECTION" ? "error" : "info"}>{w.message}</Alert>)}
      {dups.length ? (
        <Alert kind="info"><p className="font-medium">Possible duplicate{dups.length === 1 ? "" : "s"} — check before you publish.</p>
          <ul className="mt-1 list-disc pl-4">{dups.map((d) => <li key={`${d.kind}${d.id}`}>{d.reason} {d.kind === "DRIVE" ? <Link className="underline" href={`/placement/drives/${d.id}`}>View {d.label}</Link> : <Link className="underline" href={`/placement/drives/ai/${d.id}`}>View that announcement</Link>}</li>)}</ul>
          <p className="mt-1 text-xs">You can still continue. Nothing is merged or overwritten.</p></Alert>) : null}

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          {diff ? <Card title="New reading of the announcement"><DiffPanel id={rec.id} rows={diff} modelLabel={rec.pending!.provider === "rules" ? "pattern reader" : `${rec.pending!.provider} ${rec.pending!.model}`} /></Card> : null}
          <ReviewForm id={rec.id} fields={rec.fields} departments={opts.departments} readOnly={locked} />
          <Card title="Preview and publish">
            {drive ? <><p className="mb-3 text-sm text-muted">This is the saved draft exactly as students will see it. Save your changes above first.</p><DriveView drive={drive.drive} criteria={drive.criteria} departments={drive.departments} /></> : <Alert kind="info">The drive draft appears here once the company, job title and employment type are filled in and saved.</Alert>}
            {ready.warnings.length ? <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-muted" aria-label="Warnings">{ready.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul> : null}
            <div className="mt-4 border-t border-border pt-4">{locked ? <p className="text-sm">This drive is {rec.drive_status!.toLowerCase()}. <Link className="underline" href={`/placement/drives/${rec.drive_id}`}>Open the drive</Link>.</p> : <PublishPanel id={rec.id} ready={ready.ready} problems={ready.errors.map((e) => e.message)} />}</div>
          </Card>
        </div>
        <aside className="space-y-4">{source}{!locked ? <Card title="Other actions"><div className="space-y-4"><ReextractButton id={rec.id} disabled={false} />{!rec.drive_id ? <DiscardButton id={rec.id} /> : null}</div></Card> : null}</aside>
      </div>
    </div>
  );
}

import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { FILE_KIND_LABEL, OFFER_STATUS_LABEL, OFFER_TONE, PLACEMENT_LABEL, PLACEMENT_TONE } from "@/lib/offers";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { myOffer } from "@/server/offers/queries";
import { FileUpload, JoiningForm, RespondForm } from "@/components/offers/forms";

export const metadata = { title: "Offer — CampusConnect" };
const NOTICE: Record<string, string> = { accepted: "You accepted this offer.", declined: "You declined this offer.", proof: "Joining proof uploaded. Now record your joining below.", joining: "Joining recorded. The placement office will verify it." };

export default async function OfferPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const s = await requireRole("STUDENT");
  const { id } = await params; const { notice, error } = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await myOffer(s, id);
  if (!data) notFound();
  const { offer: o, files, placement } = data;
  const open = o.offer_status === "ISSUED" && !!o.response_deadline && new Date(o.response_deadline) > new Date();
  const letter = files.find((f) => f.kind === "OFFER_LETTER");
  const proof = files.find((f) => f.kind === "JOINING_PROOF");
  const canRecord = o.offer_status === "ACCEPTED" && (!placement || placement.status === "REJECTED");
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/student/offers" className="underline">← My offers</Link></p>
      {notice && NOTICE[notice] ? <Alert kind="success">{NOTICE[notice]}</Alert> : null}
      {error ? <Alert kind="error">{error.slice(0, 300)}</Alert> : null}
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{o.job_title}</h1><span className="text-muted">{o.company_name}</span><StatusBadge value={OFFER_TONE[o.offer_status]} label={OFFER_STATUS_LABEL[o.offer_status]} /></div>
      <Card title="Offer">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">CTC offered</dt><dd>{o.offered_ctc_lpa ? `${Number(o.offered_ctc_lpa).toFixed(2)} LPA` : "As per the offer letter"}</dd>
          <dt className="text-muted">Respond by</dt><dd>{o.response_deadline ? fmtDateTime(o.response_deadline) : "—"}</dd>
          {o.responded_at ? <><dt className="text-muted">You answered</dt><dd>{fmtDateTime(o.responded_at)}</dd></> : null}
          {o.withdrawal_reason ? <><dt className="text-muted">Withdrawn because</dt><dd>{o.withdrawal_reason}</dd></> : null}
          <dt className="text-muted">Offer letter</dt><dd>{letter ? <a href={`/offer-files/${letter.id}/download`} className="underline">Open {letter.original_name}</a> : "Not attached"}</dd>
        </dl>
        {o.offer_status === "NOT_ISSUED" ? <p className="mt-3 text-sm text-muted">You have been selected. The placement office has not issued the offer yet.</p> : null}
        {open ? <div className="mt-4"><RespondForm selectionId={o.id} /></div> : null}
        {o.offer_status === "ISSUED" && !open ? <p className="mt-3 text-sm text-danger">The response deadline has passed. Please contact the placement office.</p> : null}
      </Card>
      {o.offer_status === "ACCEPTED" || placement ? (
        <Card title="Joining and placement">
          {placement ? <p className="flex flex-wrap items-center gap-2 text-sm"><StatusBadge value={PLACEMENT_TONE[placement.status]} label={PLACEMENT_LABEL[placement.status]} /><span className="text-muted">joined {fmtDate(placement.joined_on)}{placement.designation ? ` as ${placement.designation}` : ""}</span></p> : <p className="text-sm text-muted">Once you have joined the company, upload your joining proof and record your joining. Your accepted offer is not counted as a placement until the placement office verifies your joining.</p>}
          {placement?.status === "REJECTED" && placement.decision_reason ? <p className="mt-2 text-sm text-danger">Not verified: {placement.decision_reason}. You can upload a new proof and record your joining again.</p> : null}
          {canRecord ? (
            <div className="mt-4 space-y-4">
              <FileUpload action={`/student/offers/${o.id}/proof`} label="Joining proof (joining letter, ID card, …)" button="Upload proof" />
              {proof ? <p className="text-sm">Latest proof: <a href={`/offer-files/${proof.id}/download`} className="underline">{proof.original_name}</a></p> : null}
              <JoiningForm selectionId={o.id} proofId={proof?.id ?? null} />
            </div>
          ) : null}
        </Card>
      ) : null}
      {files.length > 0 ? <p className="text-xs text-muted">Files here are private: only you, the placement office and your college administrator can open them.{" "}{FILE_KIND_LABEL.OFFER_LETTER}s and {FILE_KIND_LABEL.JOINING_PROOF.toLowerCase()}s are not shared with coordinators.</p> : null}
    </div>
  );
}

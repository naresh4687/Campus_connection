import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { fmtDateTime } from "@/lib/format";
import { OFFER_STATUS_LABEL, OFFER_TONE, PLACEMENT_LABEL, PLACEMENT_TONE } from "@/lib/offers";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getDrive } from "@/server/drives/queries";
import { offersForDrive, selectCandidates } from "@/server/offers/queries";
import { ExtendForm, FileUpload, IssueOfferForm, ReasonForm, SelectStudentsForm } from "@/components/offers/forms";

export const metadata = { title: "Selections and offers — CampusConnect" };
const NOTICE: Record<string, string> = { selected: "Selection recorded. No offer has been issued yet.", issued: "Offer issued. The student can now accept or decline it.", extended: "Response deadline extended.", withdrawn: "Offer withdrawn.", letter: "Offer letter uploaded." };

export default async function Offers({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ notice?: string; error?: string }> }) {
  const s = await requireRole("PLACEMENT_OFFICER");
  const { id } = await params; const { notice, error } = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getDrive(s, id);
  if (!data) notFound();
  const [candidates, rows] = await Promise.all([selectCandidates(s, id), offersForDrive(s, id)]);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href={`/placement/drives/${id}`} className="underline">← {data.drive.job_title}</Link></p>
      {notice && NOTICE[notice] ? <Alert kind="success">{NOTICE[notice]}</Alert> : null}
      {error ? <Alert kind="error">{error.slice(0, 300)}</Alert> : null}
      <h1 className="text-2xl font-semibold tracking-tight">Selections and offers — {data.drive.company_name}</h1>
      <p className="text-sm text-muted">Being selected in a round, being given an offer, accepting it, joining and a verified placement are five different things. Only a verified placement counts as a placement.</p>
      <Card title="Final selection">
        {candidates.length === 0 ? <p className="text-sm text-muted">No students are waiting to be selected. Students appear here once every round is released and they were selected in the last one.</p> : <SelectStudentsForm driveId={id} candidates={candidates} />}
      </Card>
      {rows.map((r) => (
        <Card key={r.selection_id} title={r.full_name}>
          <p className="flex flex-wrap items-center gap-2 text-sm"><span className="text-muted">{r.register_number} · {r.department_code}</span><StatusBadge value={OFFER_TONE[r.offer_status]} label={OFFER_STATUS_LABEL[r.offer_status]} />
            {r.placement_status ? <StatusBadge value={PLACEMENT_TONE[r.placement_status]} label={PLACEMENT_LABEL[r.placement_status]} /> : null}</p>
          <p className="mt-1 text-sm text-muted">{r.offered_ctc_lpa ? `${Number(r.offered_ctc_lpa).toFixed(2)} LPA · ` : ""}{r.response_deadline ? `respond by ${fmtDateTime(r.response_deadline)}` : ""}{r.responded_at ? ` · answered ${fmtDateTime(r.responded_at)}` : ""}{r.withdrawal_reason ? ` · reason: ${r.withdrawal_reason}` : ""}</p>
          {r.letter_file_id ? <p className="mt-1 text-sm"><a href={`/offer-files/${r.letter_file_id}/download`} className="underline">Open offer letter</a></p> : null}
          <div className="mt-4 space-y-4">
            {r.offer_status === "NOT_ISSUED" ? <>
              <FileUpload action={`/placement/offers/${r.selection_id}/letter?drive=${id}`} label={r.letter_file_id ? "Replace the offer letter" : "Offer letter (optional)"} button="Upload letter" />
              <IssueOfferForm driveId={id} selectionId={r.selection_id} letterId={r.letter_file_id} />
            </> : null}
            {r.offer_status === "ISSUED" ? <ExtendForm driveId={id} selectionId={r.selection_id} /> : null}
            {["NOT_ISSUED", "ISSUED", "ACCEPTED"].includes(r.offer_status) ? <ReasonForm kind="withdraw" fields={{ driveId: id, selectionId: r.selection_id }} label="Reason for withdrawing" button="Withdraw offer" hint="The student sees that the offer was withdrawn. A reason of at least 5 characters is recorded." /> : null}
          </div>
        </Card>
      ))}
      {rows.length === 0 ? <Card><p className="text-sm text-muted">No selections yet.</p></Card> : null}
    </div>
  );
}

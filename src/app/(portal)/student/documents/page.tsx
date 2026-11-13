import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { ActionButton } from "@/components/ui/action-button";
import { DocumentItem } from "@/components/ui/document-list";
import { DOC_KINDS, MAX_ACTIVE_DOCUMENTS } from "@/lib/documents";
import { requireRole } from "@/server/auth/session";
import { deleteDocumentAction } from "@/server/documents/actions";
import { documentsFor } from "@/server/documents/queries";
import { UploadForm } from "./upload-form";

export const metadata = { title: "My documents — CampusConnect" };

export default async function StudentDocuments({ searchParams }: { searchParams: Promise<{ notice?: string; error?: string }> }) {
  const s = await requireRole("STUDENT");
  const sp = await searchParams;
  const { docs, events } = await documentsFor(s);
  const active = docs.filter((d) => d.status === "ACTIVE");
  const deleted = docs.filter((d) => d.status === "DELETED");
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">My documents</h1>
      <p className="text-sm text-muted">Your documents are stored privately. They are never available through a public link: each download is checked against your permissions and works for about a minute.</p>
      {sp.notice === "uploaded" ? <Alert kind="success">Document uploaded.</Alert> : null}
      {sp.error ? <Alert kind="error">{sp.error.slice(0, 300)}</Alert> : null}

      <Card title="Upload a document">
        <UploadForm used={active.length} max={MAX_ACTIVE_DOCUMENTS} />
        <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-muted">{DOC_KINDS.map((k) => <li key={k.value}><strong className="text-foreground">{k.label}:</strong> {k.hint}</li>)}</ul>
      </Card>

      <Card title="Your documents">
        {active.length === 0 ? <p className="text-sm text-muted">No documents yet.</p> : (
          <ul className="divide-y divide-border" aria-label="Your documents">
            {active.map((d) => <DocumentItem key={d.id} doc={d} events={events.get(d.id)} showAccess actions={<ActionButton action={deleteDocumentAction} fields={{ id: d.id }} label="Delete" pendingLabel="Deleting…" small />} />)}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted">A document attached as evidence to an academic submission cannot be deleted.</p>
      </Card>

      {deleted.length > 0 ? <Card title="Deleted"><ul className="divide-y divide-border" aria-label="Deleted documents">{deleted.map((d) => <DocumentItem key={d.id} doc={d} events={events.get(d.id)} />)}</ul></Card> : null}
    </div>
  );
}

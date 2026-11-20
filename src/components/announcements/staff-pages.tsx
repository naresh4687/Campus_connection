import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { KIND_LABEL, STATUS_LABEL, batchesToText, displayStatus, isKind, isoToIstInput, stagesToText, warnings } from "@/lib/announcements";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { uuidSchema } from "@/lib/validation";
import { requireRole, type SessionUser } from "@/server/auth/session";
import { addressableDepartments, getAnnouncementForStaff, getExtraction, linkableDrives, listAnnouncements } from "@/server/announcements/queries";
import { ExtractionPanel } from "./extraction-panel";
import { AnnouncementEditor, EMPTY_VALUES, type EditorValues } from "./editor";
import { MessageView } from "./message-view";
import { ArchiveButton, PublishPanel } from "./panels";

type Role = "PLACEMENT_OFFICER" | "COORDINATOR";
const BASE: Record<Role, string> = { PLACEMENT_OFFICER: "/placement/announcements", COORDINATOR: "/coordinator/announcements" };
const tone = (s: string) => (s === "PUBLISHED" || s === "UPDATED" ? "APPROVED" : s === "EXPIRED" ? "EXPIRED" : s === "DRAFT" ? "PENDING" : "WITHDRAWN");

export async function AnnouncementList({ role }: { role: Role }) {
  const s = await requireRole(role); const base = BASE[role];
  const rows = await listAnnouncements(s);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Placement announcements</h1>
        <Link href={`${base}/compose`} className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground">Create placement update</Link>
      </div>
      <p className="text-sm text-muted">Schedules, venues, interview rounds, shortlists and instructions. An announcement never creates or changes a placement drive.</p>
      <Table head={["Title", "Type", "Company", "Event date", "Status", "Updated"]} empty={rows.length === 0 ? <EmptyState title="No announcements yet">Create one to inform students.</EmptyState> : null}>
        {rows.map((a) => { const st = displayStatus(a); return (
          <tr key={a.id}>
            <Td><Link href={`${base}/${a.id}`} className="font-medium underline">{a.title}</Link></Td>
            <Td>{isKind(a.kind) ? KIND_LABEL[a.kind] : a.kind}</Td><Td>{a.company_name ?? "—"}</Td><Td>{a.event_date ? fmtDate(a.event_date) : "—"}</Td>
            <Td><StatusBadge value={tone(st)} label={STATUS_LABEL[st] ?? st} /></Td><Td>{fmtDateTime(a.updated_at)}</Td>
          </tr>); })}
      </Table>
    </div>
  );
}

async function editorData(s: SessionUser) {
  const [departments, drives] = await Promise.all([addressableDepartments(s), linkableDrives(s)]);
  return { departments, drives };
}

export async function AnnouncementNew({ role }: { role: Role }) {
  const s = await requireRole(role); const base = BASE[role];
  const { departments, drives } = await editorData(s);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href={base} className="underline">← Announcements</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Create a placement update</h1>
      <Card><AnnouncementEditor initial={EMPTY_VALUES} departments={departments} drives={drives} coordinator={role === "COORDINATOR"} published={false} backHref={base} /></Card>
    </div>
  );
}

export async function AnnouncementEdit({ role, id, flags }: { role: Role; id: string; flags: { created?: string; published?: string; composed?: string } }) {
  const s = await requireRole(role); const base = BASE[role];
  if (!uuidSchema.safeParse(id).success) notFound();
  const rec = await getAnnouncementForStaff(s, id);
  if (!rec) notFound();
  const { a, audience, versions, engagement, named, reach } = rec;
  const { departments, drives } = await editorData(s);
  const ext = a.status === "DRAFT" ? await getExtraction(s, id) : null;
  const st = displayStatus(a);
  const archived = a.status === "ARCHIVED"; const published = a.status === "PUBLISHED";
  const initial: EditorValues = {
    ...EMPTY_VALUES, kind: a.kind, title: a.title, company_name: a.company_name ?? "", drive_id: a.drive_id ?? "", priority: a.priority, display_mode: a.display_mode, summary: a.summary ?? "", original_message: a.original_message ?? "",
    event_date: a.event_date ?? "", event_time: a.event_time ?? "", venue: a.venue ?? "", instructions: a.instructions ?? "", consent_deadline: isoToIstInput(a.consent_deadline), expires_at: isoToIstInput(a.expires_at),
    action_link: a.action_link ?? "", stages: stagesToText(a.stages), batches: batchesToText(a.batches),
    aud_source: audience?.source ?? "ALL", aud_departments: audience?.departments ?? [], aud_years: (audience?.years ?? []).join(", "), aud_career: audience?.career ?? "PLACEMENT", aud_drive: audience?.drive ?? "",
    aud_named: named.map((n) => n.register_number).join("\n"),
  };
  const warn = warnings({ event_date: a.event_date, consent_deadline: a.consent_deadline, expires_at: a.expires_at });
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href={base} className="underline">← Announcements</Link></p>
      <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold tracking-tight">{a.title}</h1><StatusBadge value={tone(st)} label={`${STATUS_LABEL[st] ?? st}${a.version > 1 ? ` (version ${a.version})` : ""}`} /></div>
      {flags.created ? <Alert kind="success">Draft saved. Nobody has been notified.{flags.composed ? " Check the type, fill in the details and choose who should receive it." : ""}</Alert> : null}
      {flags.published ? <Alert kind="success">Published. {flags.published} student(s) were notified.</Alert> : null}
      {warn.map((w) => <Alert key={w} kind="info">{w}</Alert>)}
      <div className="grid gap-6 xl:grid-cols-[1fr_26rem]">
        <div className="space-y-6">
          {archived ? <Alert kind="info">This announcement is archived and can no longer be edited.</Alert> : <Card title="Edit"><AnnouncementEditor id={a.id} initial={initial} departments={departments} drives={drives} coordinator={role === "COORDINATOR"} published={published} backHref={base} /></Card>}
        </div>
        <div className="space-y-6">
          {ext ? <Card title="What was read from the message"><ExtractionPanel x={ext.extraction} method={ext.method} /></Card> : null}
          <Card title="Student preview"><MessageView a={a} /></Card>
          {a.status === "DRAFT" ? <Card title="Publish"><PublishPanel id={a.id} audienceSet={!!audience} reach={reach} /></Card> : null}
          {engagement ? <Card title="Reach"><p className="text-sm">{engagement.recipients} notified · {engagement.seen} opened</p></Card> : null}
          {!archived ? <Card title="Archive"><ArchiveButton id={a.id} /></Card> : null}
          {versions.length ? <Card title="History"><ul className="space-y-2 text-sm">{versions.map((v) => <li key={v.version}><strong>Version {v.version}</strong> · {fmtDateTime(v.edited_at)} · {v.edited_by_name}{v.reason ? <span className="block text-muted">Reason: {v.reason}</span> : null}<span className="block text-xs text-muted">{v.recipients_count} recipient(s){v.renotified ? ", notified" : ", not re-notified"}</span></li>)}</ul></Card> : null}
        </div>
      </div>
    </div>
  );
}

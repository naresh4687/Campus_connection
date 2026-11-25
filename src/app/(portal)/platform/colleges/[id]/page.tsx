import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/ui/action-button";
import { Card } from "@/components/ui/card";
import { resetMfaAction } from "@/server/auth/mfa-actions";
import { canResetMfa } from "@/server/auth/mfa-queries";
import { StatusBadge } from "@/components/ui/status-badge";
import { COLLEGE_TYPES } from "@/lib/india";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { safeHref, uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { getCollege } from "@/server/platform/queries";
import { AccessForm, AdminInviteForm, CommercialForm } from "./college-actions";

export const metadata = { title: "College — CampusConnect" };

export default async function CollegePage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireRole("PLATFORM_SUPER_ADMIN");
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) notFound();
  const data = await getCollege(s, id);
  if (!data) notFound();
  const { college: c, internal, admins, invitations } = data;
  const href = safeHref(c.website);
  const resettable = (await Promise.all(admins.map(async (a) => ((await canResetMfa(s, a.id)) ? a : null)))).filter((a) => a !== null);
  const type = COLLEGE_TYPES.find((t) => t.value === c.college_type)?.label ?? c.college_type;
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/platform/colleges" className="underline">← Colleges</Link></p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
        <StatusBadge value={c.status} label={c.status === "ACTIVE" ? "Access active" : "Access suspended"} />
        <StatusBadge value={c.commercial_status} label={`Commercial: ${c.commercial_status.toLowerCase().replace(/_/g, " ")}`} />
      </div>

      <Card title="Profile">
        <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
          <dt className="text-muted">Official email</dt><dd>{c.official_email ?? "—"}</dd>
          <dt className="text-muted">Contact person</dt><dd>{c.contact_person ?? "—"} {c.contact_phone ? `· ${c.contact_phone}` : ""}</dd>
          <dt className="text-muted">Address</dt><dd>{[c.address, c.district, c.state].filter(Boolean).join(", ") || "—"}</dd>
          <dt className="text-muted">Website</dt><dd>{href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">{c.website}</a> : "—"}</dd>
          <dt className="text-muted">Type / strength</dt><dd>{type ?? "—"} · {c.approx_students?.toLocaleString("en-IN") ?? "—"} students (as applied)</dd>
          <dt className="text-muted">Created</dt><dd>{fmtDateTime(c.created_at)}</dd>
          {c.application_id ? (<><dt className="text-muted">Application</dt><dd><Link className="underline" href={`/platform/applications/${c.application_id}`}>View application</Link></dd></>) : null}
        </dl>
      </Card>

      <Card title="Administrators">
        {admins.length === 0 ? <p className="text-sm text-muted">No administrator has accepted an invitation yet.</p> : (
          <ul className="space-y-1 text-sm">
            {admins.map((a) => <li key={a.id}>{a.full_name} · {a.email} · <StatusBadge value={a.status} /> <span className="text-muted">· last sign-in {fmtDateTime(a.last_login_at)}</span></li>)}
          </ul>
        )}
        {resettable.map((a) => (
          <div key={a.id} className="mt-4 text-sm">
            <p className="mb-2 text-muted">{a.full_name} uses two-step sign-in. Remove it only after checking it is really them. It signs them out.</p>
            <ActionButton action={resetMfaAction} fields={{ id: a.id }} label={`Remove two-step sign-in for ${a.full_name}`} variant="danger" pendingLabel="Removing…" />
          </div>
        ))}
        {invitations.length > 0 ? (
          <div className="mt-4 text-sm">
            <p className="font-medium">Pending invitations</p>
            <ul className="mt-1 space-y-1">{invitations.map((i) => <li key={i.id}>{i.email} <span className="text-muted">· created {fmtDate(i.created_at)} · expires {fmtDateTime(i.expires_at)}</span></li>)}</ul>
          </div>
        ) : null}
        <div className="mt-5 border-t border-border pt-4">
          <h3 className="mb-2 font-medium">Issue a new administrator invitation</h3>
          <p className="mb-3 text-sm text-muted">Creating a new invitation for an email invalidates any earlier unused one. The link is shown once.</p>
          {c.status === "ACTIVE" ? <AdminInviteForm id={c.id} defaultEmail={c.official_email ?? ""} /> : <p className="text-sm text-muted">Reactivate the college before inviting administrators.</p>}
        </div>
      </Card>

      <Card title="Access">
        <AccessForm id={c.id} status={c.status} reason={internal?.suspended_reason ?? null} />
      </Card>

      <Card title="Commercial status">
        <CommercialForm id={c.id} current={c.commercial_status} note={internal?.commercial_note ?? null} />
        <p className="mt-3 text-xs text-muted">Last changed: {fmtDateTime(c.commercial_updated_at)}</p>
      </Card>
    </div>
  );
}

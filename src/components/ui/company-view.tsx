import { safeHref } from "@/lib/validation";
import type { CompanyDetail } from "@/server/companies/queries";

/** Read-only company details. Links are rendered only for http(s) websites and well-formed emails. */
export function CompanyView({ c }: { c: CompanyDetail }) {
  const href = safeHref(c.website);
  return (
    <dl className="grid grid-cols-[10rem_1fr] gap-y-2 text-sm">
      <dt className="text-muted">Website</dt><dd>{href ? <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="underline">{c.website}</a> : "—"}</dd>
      <dt className="text-muted">Industry</dt><dd>{c.industry ?? "—"}</dd>
      <dt className="text-muted">Location</dt><dd>{c.location ?? "—"}</dd>
      <dt className="text-muted">Contact person</dt><dd>{c.contact_person ?? "—"}</dd>
      <dt className="text-muted">Contact email</dt><dd>{c.contact_email ? <a href={`mailto:${encodeURIComponent(c.contact_email)}`} className="underline">{c.contact_email}</a> : "—"}</dd>
      <dt className="text-muted">Contact phone</dt><dd>{c.contact_phone ?? "—"}</dd>
      <dt className="text-muted">Description</dt><dd className="whitespace-pre-wrap">{c.description ?? "—"}</dd>
    </dl>
  );
}

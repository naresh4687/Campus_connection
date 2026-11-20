import { FormattedMessage } from "@/components/announcements/formatted-message";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { KIND_LABEL, isKind } from "@/lib/announcements";
import type { AnnouncementFull } from "@/server/announcements/queries";

/** What a student sees. Staff see the same component as their preview. Everything is rendered as text. */
export function MessageView({ a }: { a: AnnouncementFull }) {
  const summary = a.display_mode !== "ORIGINAL" && a.summary;
  const original = a.display_mode !== "SUMMARY" && a.original_message;
  const rows: [string, string][] = [];
  if (a.company_name) rows.push(["Company", a.company_name]);
  if (a.event_date) rows.push(["Date", fmtDate(a.event_date)]);
  if (a.event_time) rows.push(["Time", a.event_time]);
  if (a.venue) rows.push(["Venue", a.venue]);
  if (a.consent_deadline) rows.push(["Reply by", fmtDateTime(a.consent_deadline)]);
  return (
    <article className="space-y-4" aria-label="Announcement">
      <p className="text-xs uppercase tracking-wide text-muted">{isKind(a.kind) ? KIND_LABEL[a.kind] : a.kind}</p>
      <h2 className="text-xl font-semibold">{a.title}</h2>
      {rows.length ? <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">{rows.map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}</dl> : null}
      {a.stages.length ? <section><h3 className="text-sm font-semibold">Process</h3><ol className="mt-1 list-decimal pl-5 text-sm">{a.stages.map((s, i) => <li key={i}>{s}</li>)}</ol></section> : null}
      {a.batches.length ? <section><h3 className="text-sm font-semibold">Batches</h3>
        <div className="mt-1 overflow-x-auto rounded-xl border border-border"><table className="w-full text-left text-sm"><caption className="sr-only">Venue for each batch</caption><thead className="bg-background text-xs text-muted"><tr><th scope="col" className="px-3 py-2">Batch</th><th scope="col" className="px-3 py-2">Venue</th><th scope="col" className="px-3 py-2">Note</th></tr></thead>
          <tbody>{a.batches.map((b) => <tr key={b.name} className="border-t border-border"><td className="px-3 py-2 font-medium">{b.name}</td><td className="px-3 py-2">{b.venue}</td><td className="px-3 py-2">{b.note ?? ""}</td></tr>)}</tbody></table></div></section> : null}
      {summary ? <FormattedMessage text={a.summary!} /> : null}
      {a.instructions ? <section><h3 className="text-sm font-semibold">Instructions</h3><FormattedMessage text={a.instructions} /></section> : null}
      {a.action_link && /^https?:\/\//.test(a.action_link) ? <p className="text-sm"><a href={a.action_link} target="_blank" rel="noopener noreferrer nofollow" className="underline">Open the link</a></p> : null}
      {original ? <section className="rounded-xl border border-border bg-background p-3"><h3 className="mb-1 text-sm font-semibold">Original message</h3><FormattedMessage text={a.original_message!} /></section> : null}
    </article>
  );
}

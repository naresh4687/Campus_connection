import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { fmtDateTime } from "@/lib/format";
import { CATEGORY_LABEL } from "@/lib/notifications";
import { markAllReadAction } from "@/server/notifications/actions";
import { listNotifications } from "@/server/notifications/queries";
import { requireSession } from "@/server/auth/session";
import { scopedHref } from "@/lib/portals";

export const metadata = { title: "Notifications — CampusConnect" };

export default async function Notifications({ searchParams }: { searchParams: Promise<{ page?: string; notice?: string }> }) {
  const s = await requireSession();
  const sp = await searchParams;
  const page = parsePage(sp.page);
  const { rows, total } = await listNotifications(s, page);
  const unread = rows.filter((r) => !r.read_at).length;
  return (
    <div className="space-y-6">
      {sp.notice === "all-read" ? <Alert kind="success">All notifications marked as read.</Alert> : null}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <div className="flex gap-3"><Link href={scopedHref("/notifications/preferences", s.slot)} className="inline-flex h-10 items-center text-sm underline">Preferences</Link>
          <form action={markAllReadAction}><Button type="submit" variant="secondary" disabled={unread === 0 && page === 1}>Mark all as read</Button></form></div>
      </div>
      {rows.length === 0 ? <p className="card p-6 text-sm text-muted">You have no notifications yet. Updates about drives, results, offers and reviews appear here.</p> : (
        <ul className="divide-y divide-border card" aria-label="Notifications">
          {rows.map((n) => (
            <li key={n.id} className={`p-4 ${n.read_at ? "" : "bg-background"}`}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                {!n.read_at ? <span className="rounded-full border border-primary px-2 py-0.5 text-xs font-medium text-primary">Unread</span> : null}
                {/* a plain anchor on purpose: a full page load refreshes the unread count in the header */}
                <a href={scopedHref(`/notifications/${n.id}/open`, s.slot)} className={`text-sm underline ${n.read_at ? "" : "font-semibold"}`}>{n.title}</a>
                <span className="text-xs text-muted">{CATEGORY_LABEL[n.category]} · {fmtDateTime(n.created_at)}</span>
              </div>
              {n.body ? <p className="mt-1 text-sm text-muted">{n.body}</p> : null}
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} total={total} basePath="/notifications" params={{ as: s.slot }} />
    </div>
  );
}

import Link from "next/link";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { requireRole } from "@/server/auth/session";
import { listInquiries } from "@/server/platform/queries";
import { HandleButton } from "./handle-button";

export const metadata = { title: "Inquiries — CampusConnect" };

export default async function InquiriesPage({ searchParams }: { searchParams: Promise<{ status?: string; page?: string }> }) {
  const s = await requireRole("PLATFORM_SUPER_ADMIN");
  const sp = await searchParams;
  const status = sp.status === "NEW" || sp.status === "HANDLED" ? sp.status : undefined;
  const page = parsePage(sp.page);
  const { rows, total } = await listInquiries(s, { status, page });
  const chip = (v: string | undefined, label: string) => (
    <Link key={label} href={v ? `/platform/inquiries?status=${v}` : "/platform/inquiries"} aria-current={(v ?? "") === (status ?? "") ? "page" : undefined}
      className={`rounded-full border px-3 py-1 text-sm ${(v ?? "") === (status ?? "") ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-background"}`}>{label}</Link>
  );
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Inquiries</h1>
      <p className="text-sm text-muted">Messages sent through the public contact form. Reply from your own mailbox, then mark the message handled.</p>
      <div className="flex gap-2">{chip(undefined, "All")}{chip("NEW", "New")}{chip("HANDLED", "Handled")}</div>
      {rows.length === 0 ? <div className="card"><EmptyState title="No inquiries">Messages from the contact page appear here.</EmptyState></div> : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="card p-4">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{r.name}</span>
                <a href={`mailto:${encodeURIComponent(r.email)}`} className="underline">{r.email}</a>
                {r.organization ? <span className="text-muted">· {r.organization}</span> : null}
                <span className="text-muted">· {fmtDateTime(r.created_at)}</span>
                <StatusBadge value={r.status} />
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm">{r.message}</p>
              {r.status === "NEW" ? <div className="mt-3"><HandleButton id={r.id} /></div> : null}
            </li>
          ))}
        </ul>
      )}
      <Pagination page={page} total={total} basePath="/platform/inquiries" params={{ status }} />
    </div>
  );
}

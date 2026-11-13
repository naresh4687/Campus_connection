import Link from "next/link";
import { sql } from "kysely";
import { Alert } from "@/components/ui/alert";
import { StatusBadge } from "@/components/ui/status-badge";
import { db } from "@/server/db";
import { hashToken, isWellFormedToken } from "@/server/auth/tokens";

export const metadata = { title: "Application status — CampusConnect" };

const COPY: Record<string, string> = {
  SUBMITTED: "We have received your application. The team has not started reviewing it yet.",
  UNDER_REVIEW: "Your application is being reviewed.",
  APPROVED: "Your application was approved. We will send your college administrator a one-time invitation link directly (email delivery is not enabled yet). If you have not received it, contact us.",
  REJECTED: "Your application was not approved.",
};

export default async function ApplicationStatusPage({ searchParams }: { searchParams: Promise<{ ref?: string; new?: string }> }) {
  const { ref, new: isNew } = await searchParams;
  const row = isWellFormedToken(ref)
    ? (await sql<{ status: string; name: string; submitted_at: Date; decided_at: Date | null; decision_reason: string | null }>`SELECT * FROM platform.application_status(${hashToken(ref)})`.execute(db())).rows[0]
    : undefined;

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-14">
      <h1 className="text-3xl font-semibold tracking-tight">Application status</h1>
      {row ? (
        <div className="mt-6 space-y-4">
          {isNew ? <Alert kind="success">Application submitted. Save this page&apos;s link — it is the only way to check your status.</Alert> : null}
          <div className="rounded-2xl border border-border bg-surface p-6">
            <p className="text-sm text-muted">Application for</p>
            <p className="text-lg font-semibold">{row.name}</p>
            <p className="mt-3"><StatusBadge value={row.status} /></p>
            <p className="mt-3 text-sm">{COPY[row.status]}</p>
            {row.status === "REJECTED" && row.decision_reason ? (
              <div className="mt-4 rounded-xl border border-border bg-background p-3 text-sm">
                <p className="font-medium">Reason</p>
                <p className="mt-1 whitespace-pre-wrap">{row.decision_reason}</p>
                <p className="mt-2 text-muted">You may submit a new application once the issue is addressed.</p>
              </div>
            ) : null}
            <dl className="mt-4 grid grid-cols-[9rem_1fr] gap-y-1 text-sm">
              <dt className="text-muted">Submitted</dt><dd>{row.submitted_at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST</dd>
              {row.decided_at ? (<><dt className="text-muted">Decided</dt><dd>{row.decided_at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" })} IST</dd></>) : null}
            </dl>
          </div>
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <Alert kind="error">No application was found for this link. Check that you copied the whole link.</Alert>
          <p className="text-sm"><Link href="/apply" className="underline">Submit an application</Link> · <Link href="/contact" className="underline">Contact us</Link></p>
        </div>
      )}
    </main>
  );
}

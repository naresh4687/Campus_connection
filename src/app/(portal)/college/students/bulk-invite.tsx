"use client";

import { useActionState } from "react";
import { csvCell } from "@/lib/csv";
import { bulkInviteAction } from "@/server/students/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

function download(headers: string[], rows: string[][]) {
  const csv = "﻿" + [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = "student-invitations.csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

/** Creates one-time invitations for everyone matching the current filters who has no account and no live invitation. */
export function BulkInvite({ q, dept, year, eligible }: { q?: string; dept?: string; year?: string; eligible: number }) {
  const [state, action, pending] = useActionState(bulkInviteAction, undefined);
  return (
    <div className="space-y-4">
      <form action={action} className="space-y-3">
        <input type="hidden" name="q" value={q ?? ""} /><input type="hidden" name="dept" value={dept ?? ""} /><input type="hidden" name="year" value={year ?? ""} />
        <p className="text-sm text-muted">Creates a one-time invitation link for each student matching the current search and filters who has no account and no live invitation (up to 500 per run). Email delivery is not enabled, so you distribute the links yourself — download them as a CSV.</p>
        <p className="text-sm"><strong data-testid="invitable-count">{eligible}</strong> student(s) currently match and still need an invitation.</p>
        <Button type="submit" disabled={pending || eligible === 0}>{pending ? "Creating invitations…" : "Create invitations for matching students"}</Button>
      </form>
      {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
      {state?.ok ? <Alert kind="success">{state.ok}</Alert> : null}
      {state?.notes?.map((n) => <Alert key={n}>{n}</Alert>)}
      {state?.table && state.table.rows.length > 0 ? (
        <div className="space-y-3" data-testid="bulk-links">
          <Alert>These links are shown only now and are not stored. Download them before leaving this page.</Alert>
          <Button type="button" variant="secondary" onClick={() => download(state.table!.headers, state.table!.rows)}>Download links as CSV</Button>
          <div tabIndex={0} className="focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary overflow-x-auto rounded-2xl border border-border">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <thead className="border-b border-border bg-background text-xs uppercase tracking-wide text-muted"><tr>{state.table.headers.map((h) => <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-border">
                {state.table.rows.slice(0, 50).map((r) => <tr key={r[0]}>{r.map((c, i) => <td key={i} className={`px-3 py-2 ${i === 3 ? "max-w-xs truncate font-mono text-xs" : ""}`}>{c}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
          {state.table.rows.length > 50 ? <p className="text-xs text-muted">Showing the first 50 of {state.table.rows.length}; the download contains all of them.</p> : null}
        </div>
      ) : null}
    </div>
  );
}

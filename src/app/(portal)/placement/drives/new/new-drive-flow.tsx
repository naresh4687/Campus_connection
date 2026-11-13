"use client";

import { useActionState, useState } from "react";
import { extractDriveAction } from "@/server/drives/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { MAX_ANNOUNCEMENT_CHARS } from "@/lib/ai-extract";
import { DriveForm, type DriveValues } from "../drive-form";

export function NewDriveFlow({ aiEnabled, companies, departments, initial }: { aiEnabled: boolean; companies: { id: string; name: string }[]; departments: { id: string; code: string; name: string }[]; initial: DriveValues }) {
  const [state, run, pending] = useActionState(extractDriveAction, undefined);
  const [applied, setApplied] = useState<{ version: number; values: DriveValues }>({ version: 0, values: {} });
  const { announcement, ...extracted } = (state?.values ?? {}) as DriveValues;
  const hasResult = !!state?.table;
  return (
    <div className="space-y-6">
      {aiEnabled ? (
        <Card title="Fill from an announcement (optional, AI-assisted)">
          <form action={run} className="space-y-3">
            <Textarea id="announcement" label="Company announcement" rows={8} maxLength={MAX_ANNOUNCEMENT_CHARS} defaultValue={announcement ?? ""} hint={`Paste the announcement text (up to ${MAX_ANNOUNCEMENT_CHARS} characters). Do not paste students’ personal data.`} />
            {state?.error ? <Alert kind="error">{state.error}</Alert> : null}
            <Button type="submit" variant="secondary" disabled={pending}>{pending ? "Reading…" : "Extract details"}</Button>
          </form>
          {hasResult ? (
            <div className="mt-4 space-y-3" aria-live="polite">
              <Alert kind="info">{state?.ok}</Alert>
              <p className="text-sm text-muted">An AI assistant read the announcement. Only values it could point to in your text are kept, and you must still check every field. Nothing is saved or published until you create the draft yourself, and eligibility is always decided by the platform from the criteria you save.</p>
              <div className="overflow-x-auto rounded-md border border-border"><table className="w-full text-left text-sm"><caption className="sr-only">Details found in the announcement</caption>
                <thead className="bg-background text-xs text-muted"><tr>{state!.table!.headers.map((h) => <th key={h} className="px-3 py-2">{h}</th>)}</tr></thead>
                <tbody>{state!.table!.rows.map((r, i) => <tr key={i} className="border-t border-border">{r.map((c, j) => <td key={j} className="px-3 py-2 align-top">{c}</td>)}</tr>)}</tbody></table></div>
              {state?.notes && state.notes.length > 0 ? <ul className="list-disc space-y-1 pl-5 text-sm" aria-label="Things to check">{state.notes.map((n, i) => <li key={i}>{n}</li>)}</ul> : null}
              <Button type="button" onClick={() => setApplied((a) => ({ version: a.version + 1, values: extracted }))}>Use these details in the form below</Button>
              {applied.version > 0 ? <p className="text-sm text-success" role="status">The form below has been filled in. Review it before creating the draft.</p> : null}
            </div>
          ) : null}
        </Card>
      ) : <p className="text-sm text-muted">The AI announcement assistant is not configured for this installation. Fill in the form yourself.</p>}
      <Card><DriveForm key={applied.version} companies={companies} departments={departments} initial={{ ...initial, ...applied.values }} /></Card>
    </div>
  );
}

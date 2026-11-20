"use client";

import { useActionState, useState } from "react";
import { startIntakeAction } from "@/server/intake/actions";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MAX_SOURCE_CHARS } from "@/lib/intake/catalog";
import { DriveForm, type DriveValues } from "../drive-form";

type Mode = "manual" | "ai";

export function NewDriveFlow({ modelOn, companies, departments, initial }: { modelOn: boolean; companies: { id: string; name: string }[]; departments: { id: string; code: string; name: string }[]; initial: DriveValues }) {
  const [mode, setMode] = useState<Mode>("manual");
  const [state, run, pending] = useActionState(startIntakeAction, undefined);
  const [key, setKey] = useState(() => crypto.randomUUID());
  const opt = (m: Mode, title: string, body: string) => (
    <button type="button" role="radio" aria-checked={mode === m} onClick={() => setMode(m)} data-option={m}
      className={`rounded-2xl border p-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${mode === m ? "border-foreground bg-tint" : "border-border bg-surface hover:border-foreground/35"}`}>
      <span className="block font-semibold">{title}</span><span className="mt-1 block text-sm text-muted">{body}</span>
    </button>
  );
  return (
    <div className="space-y-6">
      <div role="radiogroup" aria-label="How do you want to create the drive?" className="grid gap-3 sm:grid-cols-2">
        {opt("manual", "Manual creation", "Type the details of the drive yourself.")}
        {opt("ai", "AI-assisted creation", "Paste the company’s announcement. We read it, point out what is missing or unclear, and save an editable draft for you to check.")}
      </div>
      {mode === "ai" ? (
        <Card title="Paste the company announcement">
          <form action={run} className="space-y-3">
            <input type="hidden" name="key" value={key} />
            <div className="space-y-1.5">
              <label htmlFor="announcement" className="block text-sm font-semibold">Company announcement</label>
              <textarea id="announcement" name="announcement" rows={12} maxLength={MAX_SOURCE_CHARS + 50} defaultValue={state?.values?.announcement ?? ""} onChange={() => setKey(crypto.randomUUID())}
                aria-describedby="announcement-hint" className="w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm outline-none hover:border-foreground/35 focus-visible:border-foreground focus-visible:ring-2 focus-visible:ring-foreground/15" />
              <p id="announcement-hint" className="text-xs text-muted">Paste the email, circular or WhatsApp message as received (up to {MAX_SOURCE_CHARS.toLocaleString("en-IN")} characters). Do not paste students’ personal data. The original text is kept with the draft.</p>
            </div>
            <div className="space-y-1.5"><label htmlFor="sourceType" className="block text-sm font-semibold">Where did it come from?</label>
              <select id="sourceType" name="sourceType" defaultValue="PASTED" className="h-11 rounded-xl border border-border bg-surface px-3 text-sm"><option value="PASTED">Pasted text</option><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp message</option><option value="OTHER">Other</option></select></div>
            {state?.error ? <Alert kind="error">{state.error} Your text is still in the box. You can try again, or <button type="button" className="underline" onClick={() => setMode("manual")}>create the drive manually</button>.</Alert> : null}
            <p className="text-xs text-muted">{modelOn ? "An AI model helps read the text; fixed patterns check dates, salary, CGPA and arrears." : "No AI model is configured, so only the pattern-based reader will run. It handles clearly written details and flags the rest."} The AI never publishes a drive or decides who is eligible.</p>
            <Button type="submit" disabled={pending} pending={pending}>{pending ? "Reading the announcement…" : "Extract details"}</Button>
          </form>
        </Card>
      ) : <Card><DriveForm companies={companies} departments={departments} initial={initial} /></Card>}
    </div>
  );
}

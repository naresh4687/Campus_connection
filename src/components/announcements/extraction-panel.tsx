import type { AnnField, AnnouncementExtraction } from "@/lib/composer/extract";

const LABEL: Record<string, string> = {
  title: "Title", company_name: "Company", event_date: "Event date", event_time: "Time", venue: "Venue", stages: "Recruitment stages", batches: "Batches and venues",
  consent_deadline: "Consent deadline", action_link: "Action link", instructions: "Instructions", summary: "Summary lines", drive: "Related drive",
};
const STATUS: Record<string, { text: string; cls: string }> = {
  EXTRACTED: { text: "Found", cls: "bg-brand/55 text-foreground" }, NEEDS_REVIEW: { text: "Check", cls: "bg-warning/14 text-warning" }, MISSING: { text: "Not in the message", cls: "bg-muted/12 text-muted" },
  AMBIGUOUS: { text: "Unclear", cls: "bg-warning/14 text-warning" }, CONTRADICTORY: { text: "Conflict", cls: "bg-danger/12 text-danger" },
};
const show = (f: AnnField): string => {
  if (f.value === null || f.value === undefined) return f.candidates?.length ? f.candidates.join(" or ") : "—";
  if (Array.isArray(f.value)) return f.value.map((v) => (typeof v === "object" ? `${(v as { name: string }).name}: ${(v as { venue: string }).venue}` : String(v))).join("; ");
  return String(f.value);
};

/** What the reader found, field by field, with the sentence each value came from. Only found or "check" values were put in the draft; the rest are listed for the staff member to settle. */
export function ExtractionPanel({ x, method }: { x: AnnouncementExtraction; method: string }) {
  const keys = (Object.keys(LABEL) as (keyof AnnouncementExtraction)[]).filter((k) => k !== "warnings");
  const open = keys.filter((k) => ["AMBIGUOUS", "CONTRADICTORY", "NEEDS_REVIEW"].includes((x[k] as AnnField).status));
  const missing = keys.filter((k) => (x[k] as AnnField).status === "MISSING");
  return (
    <div className="space-y-3 text-sm" data-testid="extraction-panel">
      <p className="text-xs text-muted">Read by the {method === "patterns" ? "pattern reader (no AI model)" : method}. Nothing here is published, and nothing was invented.</p>
      {x.warnings.map((w) => <p key={w} className="rounded-xl border border-border bg-background p-2 text-xs">{w}</p>)}
      <ul className="space-y-2" aria-label="What was found">
        {keys.filter((k) => (x[k] as AnnField).status !== "MISSING").map((k) => {
          const f = x[k] as AnnField; const st = STATUS[f.status];
          return (
            <li key={k} data-field={k} data-status={f.status} className="rounded-xl border border-border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{LABEL[k]}</span><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${st.cls}`}>{st.text}</span></div>
              <p className="mt-0.5 break-words">{show(f)}</p>
              <p className="mt-0.5 text-xs text-muted">“{f.evidence}”{f.note ? ` — ${f.note}` : ""}</p>
            </li>);
        })}
      </ul>
      {open.length ? <p className="text-xs">To settle: {open.map((k) => LABEL[k]).join(", ")}.</p> : null}
      {missing.length ? <p className="text-xs text-muted" data-testid="extraction-missing">Not in the message: {missing.map((k) => LABEL[k]).join(", ")}.</p> : null}
    </div>
  );
}

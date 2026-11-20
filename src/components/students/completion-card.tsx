import Link from "next/link";
import { COMPLETION_ITEMS, missingItems, type CompletionFlags } from "@/lib/completion";

/** A progress bar (always with the number, never colour alone) and the checklist. Students get links to fix what is missing; staff just see it. */
export function CompletionBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-3" data-testid="completion-bar">
      <progress value={score} max={100} aria-label="Profile completion" className="h-2 w-28 overflow-hidden rounded-full accent-brand [&::-moz-progress-bar]:bg-brand [&::-webkit-progress-bar]:bg-muted/20 [&::-webkit-progress-value]:bg-brand" />
      <span className="text-sm font-semibold tabular-nums" data-testid="completion-score">{score}%</span>
    </div>
  );
}

export function CompletionChecklist({ flags, score, forStudent }: { flags: CompletionFlags; score: number; forStudent: boolean }) {
  const missing = missingItems(flags);
  return (
    <div className="space-y-3">
      <CompletionBar score={score} />
      <ul className="space-y-1.5 text-sm" aria-label="Profile checklist">
        {COMPLETION_ITEMS.map((i) => (
          <li key={i.key} className="flex flex-wrap items-baseline gap-x-2" data-testid={`completion-${i.key}`}>
            <span aria-hidden="true">{flags[i.key] ? "✓" : "○"}</span>
            <span className={flags[i.key] ? "" : "font-medium"}>{i.label}</span>
            <span className="text-xs text-muted">{flags[i.key] ? "done" : "missing"} · {i.weight} points</span>
            {!flags[i.key] && forStudent ? <span className="text-xs">— <Link href={i.href} className="underline">{i.todo}</Link></span> : null}
          </li>
        ))}
      </ul>
      {missing.length === 0 ? <p className="text-sm text-muted">Your profile is complete.</p> : null}
    </div>
  );
}

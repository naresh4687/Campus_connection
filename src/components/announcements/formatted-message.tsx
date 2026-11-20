import { formatMessage, isSafeHref } from "@/lib/message-format";

/** A pasted company message shown as it was written: line breaks and numbering kept, *bold* / _italic_ / ~strike~ and links recognised, everything else plain text. */
export function FormattedMessage({ text }: { text: string }) {
  const lines = formatMessage(text);
  return (
    <div className="space-y-0 break-words text-sm leading-relaxed" data-testid="formatted-message">
      {lines.map((segs, i) => (
        <p key={i} className="min-h-[1.25em] whitespace-pre-wrap">
          {segs.map((s, j) =>
            s.t === "bold" ? <strong key={j}>{s.v}</strong>
            : s.t === "italic" ? <em key={j}>{s.v}</em>
            : s.t === "strike" ? <s key={j}>{s.v}</s>
            : s.t === "link" ? (isSafeHref(s.href) ? <a key={j} href={s.href} target="_blank" rel="noopener noreferrer nofollow" className="underline">{s.v}</a> : <span key={j}>{s.v}</span>)
            : <span key={j}>{s.v}</span>)}
        </p>
      ))}
    </div>
  );
}

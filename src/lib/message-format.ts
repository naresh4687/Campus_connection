/**
 * Turns a company or WhatsApp-style message into safe display segments. Nothing is rewritten: line breaks, numbering, bullets and emojis stay as typed.
 * Recognised (and nothing else): *bold*, _italic_, ~strike~ and links. The result is plain data for React to render as text, never HTML.
 */
export type Seg = { t: "text" | "bold" | "italic" | "strike"; v: string } | { t: "link"; v: string; href: string };
export type Line = Seg[];

const URL_RE = /https?:\/\/[^\s<>"']+/g;
const MARK_RE = /(\*[^*\n]{1,300}\*|_[^_\n]{1,300}_|~[^~\n]{1,300}~)/g;
const TRAIL = /[.,;:!?)\]]+$/;

function linkify(text: string, kind: "text" | "bold" | "italic" | "strike"): Seg[] {
  const out: Seg[] = []; let last = 0;
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0]; const trail = TRAIL.exec(raw)?.[0] ?? ""; const url = trail ? raw.slice(0, -trail.length) : raw;
    const i = m.index ?? 0;
    if (i > last) out.push({ t: kind, v: text.slice(last, i) });
    out.push({ t: "link", v: url, href: url });
    last = i + url.length;
  }
  if (last < text.length) out.push({ t: kind, v: text.slice(last) });
  return out;
}

function inline(line: string): Seg[] {
  const out: Seg[] = []; let last = 0;
  // Marks never wrap a link (an underscore inside a URL must stay a URL): protect URLs first.
  const parts = line.split(/(https?:\/\/[^\s<>"']+)/g);
  for (const part of parts) {
    if (/^https?:\/\//.test(part)) { out.push(...linkify(part, "text")); continue; }
    last = 0;
    for (const m of part.matchAll(MARK_RE)) {
      const i = m.index ?? 0;
      if (i > last) out.push({ t: "text", v: part.slice(last, i) });
      const tok = m[0]; const inner = tok.slice(1, -1);
      const boundaryBefore = i === 0 || /[\s([{]/.test(part[i - 1]); const boundaryAfter = i + tok.length >= part.length || /[\s.,;:!?)\]}]/.test(part[i + tok.length]);
      if (inner.trim() === "" || inner !== inner.trim() || !boundaryBefore || !boundaryAfter) { out.push({ t: "text", v: tok }); last = i + tok.length; continue; }
      out.push({ t: tok[0] === "*" ? "bold" : tok[0] === "_" ? "italic" : "strike", v: inner });
      last = i + tok.length;
    }
    if (last < part.length) out.push({ t: "text", v: part.slice(last) });
  }
  return out.length ? out : [{ t: "text", v: "" }];
}

export const formatMessage = (message: string): Line[] => message.replace(/\r\n?/g, "\n").split("\n").map(inline);
export const isSafeHref = (h: string) => /^https?:\/\/[^\s]+$/.test(h);

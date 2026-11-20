/**
 * Copies text and reports whether the browser really did it. Tries the async Clipboard API (needs HTTPS or localhost and
 * a user gesture), then the legacy `execCommand("copy")` path, which also works on plain-http pages and older mobile
 * browsers. Returns "unavailable" when neither worked, so the caller can show the link for manual copying. It never
 * touches the invitation itself: copying cannot create, regenerate or consume a token.
 */
export type CopyResult = "copied" | "unavailable";

export async function copyText(text: string, source?: HTMLInputElement | null): Promise<CopyResult> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
  } catch { /* permission denied or not focused: fall through to the legacy path */ }
  try {
    const el = source ?? Object.assign(document.createElement("textarea"), { value: text, readOnly: true });
    if (!source) { el.style.position = "fixed"; el.style.opacity = "0"; document.body.appendChild(el); }
    el.focus(); el.select(); el.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    if (!source) el.remove();
    return ok ? "copied" : "unavailable";
  } catch { return "unavailable"; }
}

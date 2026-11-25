import Link from "next/link";

/** Shown beside forms that collect personal data. Opens in a new tab so nothing already typed is lost. */
export function PrivacyNote() {
  return (
    <p className="text-xs text-muted">
      We store what you enter here to handle this request.{" "}
      <Link href="/privacy" target="_blank" className="font-medium underline underline-offset-4">Read how your data is used</Link> (opens in a new tab).
    </p>
  );
}

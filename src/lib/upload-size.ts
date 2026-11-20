/**
 * Size gate for upload requests, checked before the body is read. Browsers always declare the size of a form upload;
 * a request without it (a chunked body) could otherwise skip this gate and be read in full, so it is refused.
 * Returns null when the request may proceed, or the status to answer with.
 */
export function uploadSizeStatus(contentLength: string | null, maxBodyBytes: number): 411 | 413 | null {
  const declared = Number(contentLength);
  if (contentLength === null || contentLength.trim() === "" || !Number.isFinite(declared) || declared <= 0) return 411;
  if (declared > maxBodyBytes) return 413;
  return null;
}

"use client";

import { useState } from "react";
import { DOC_KINDS, MAX_DOCUMENT_BYTES, MAX_DOCUMENT_MB } from "@/lib/documents";
import { Alert } from "@/components/ui/alert";

/** Native multipart form. The client check is a convenience only; the server re-validates size, content and ownership. */
export function UploadForm({ used, max }: { used: number; max: number }) {
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <form action="/student/documents/upload" method="post" encType="multipart/form-data" className="max-w-xl space-y-4"
      onSubmit={(e) => { if (problem) e.preventDefault(); }}>
      {problem ? <Alert kind="error">{problem}</Alert> : null}
      <div className="space-y-1">
        <label htmlFor="kind" className="block text-sm font-medium">Kind of document</label>
        <select id="kind" name="kind" required defaultValue="" className="h-10 w-full rounded-xl border border-border bg-surface px-3 text-sm">
          <option value="" disabled>Choose…</option>
          {DOC_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="file" className="block text-sm font-medium">File</label>
        <input id="file" name="file" type="file" required accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg"
          onChange={(e) => { const f = e.target.files?.[0]; setProblem(f && f.size > MAX_DOCUMENT_BYTES ? `That file is larger than ${MAX_DOCUMENT_MB} MB. Choose a smaller file.` : null); }}
          className="block w-full text-sm file:mr-3 file:h-10 file:rounded-xl file:border file:border-border file:bg-surface file:px-4 file:text-sm" />
        <p className="text-xs text-muted">PDF, PNG or JPEG, up to {MAX_DOCUMENT_MB} MB. You can keep up to {max} documents ({used} used). The file’s content is checked, not just its name. Files are not virus-scanned yet.</p>
      </div>
      <button type="submit" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground">Upload</button>
    </form>
  );
}

import Link from "next/link";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, Td } from "@/components/ui/table";
import { fmtDateTime } from "@/lib/format";
import { CSV_LIMITS } from "@/lib/csv";
import { DEGREES, STUDENT_FIELDS } from "@/lib/students";
import { requireRole } from "@/server/auth/session";
import { listImports } from "@/server/students/queries";

export const metadata = { title: "Import students — CampusConnect" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const { error } = await searchParams;
  const imports = await listImports(s);
  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/college/students" className="underline">← Students</Link></p>
      <h1 className="text-2xl font-semibold tracking-tight">Import students from CSV</h1>

      <Card title="1. Upload a file">
        {error ? <div className="mb-4"><Alert kind="error">{error.slice(0, 300)}</Alert></div> : null}
        <form action="/college/students/import/upload" method="post" encType="multipart/form-data" className="max-w-xl space-y-3">
          <div className="space-y-1">
            <label htmlFor="file" className="block text-sm font-medium">CSV file</label>
            <input id="file" name="file" type="file" accept=".csv,text/csv" required className="block w-full text-sm file:mr-3 file:h-10 file:rounded-md file:border file:border-border file:bg-surface file:px-4 file:text-sm" />
          </div>
          <button type="submit" className="inline-flex h-10 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Upload and continue</button>
        </form>
        <div className="mt-5 space-y-2 text-sm text-muted">
          <p>The first row must be a header. Up to {CSV_LIMITS.rows.toLocaleString("en-IN")} rows, {CSV_LIMITS.bytes / 1024 / 1024} MB, UTF-8. You choose which column holds which field in the next step.</p>
          <p><strong className="text-foreground">Required:</strong> {STUDENT_FIELDS.filter((f) => f.required).map((f) => f.label).join(", ")}. <strong className="text-foreground">Optional:</strong> {STUDENT_FIELDS.filter((f) => !f.required).map((f) => f.label).join(", ")}.</p>
          <p>Degree values such as BE, B.Tech or Bachelor of Engineering are recognised; the accepted degrees are {DEGREES.join(", ")}.</p>
          <p><strong className="text-foreground">Existing students are never changed by an import.</strong> A row that matches an existing register number or college email is reported as a duplicate and skipped. Academic marks are not imported here.</p>
        </div>
      </Card>

      <Card title="Recent imports">
        {imports.length === 0 ? <p className="text-sm text-muted">No imports yet.</p> : (
          <Table head={["File", "Uploaded", "Rows", "Status", "Result"]}>
            {imports.map((i) => (
              <tr key={i.id}>
                <Td><Link href={`/college/students/import/${i.id}`} className="font-medium underline">{i.filename}</Link></Td>
                <Td>{fmtDateTime(i.created_at)}</Td>
                <Td>{i.total_rows}</Td>
                <Td><StatusBadge value={i.status} /></Td>
                <Td>{i.status === "COMMITTED" ? `${i.imported_rows} imported, ${i.duplicate_rows} duplicate, ${i.error_rows} with problems` : i.status === "VALIDATED" ? `${i.valid_rows} ready, ${i.duplicate_rows} duplicate, ${i.error_rows} with problems` : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </div>
  );
}

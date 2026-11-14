import Link from "next/link";
import { notFound } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Pagination, parsePage } from "@/components/ui/pagination";
import { StatusBadge } from "@/components/ui/status-badge";
import { EmptyState, Table, Td } from "@/components/ui/table";
import { autoMap, emptyMapping, type Mapping } from "@/lib/students";
import { uuidSchema } from "@/lib/validation";
import { requireRole } from "@/server/auth/session";
import { activeDepartments, getImport, listImportRows } from "@/server/students/queries";
import { CancelForm, CommitForm } from "./import-actions";
import { MappingForm } from "./mapping-form";

export const metadata = { title: "Import — CampusConnect" };

const RESULT_LABEL: Record<string, string> = { VALID: "Ready", ERROR: "Problem", DUPLICATE: "Duplicate", IMPORTED: "Imported" };

function Stat({ label, value, testid }: { label: string; value: number; testid: string }) {
  return <div className="rounded-2xl border border-border bg-surface p-4"><p className="text-sm text-muted">{label}</p><p className="mt-1 text-3xl font-semibold tabular-nums" data-testid={testid}>{value}</p></div>;
}

export default async function ImportDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string; page?: string }> }) {
  const s = await requireRole("COLLEGE_ADMIN");
  const { id } = await params;
  const sp = await searchParams;
  if (!uuidSchema.safeParse(id).success) notFound();
  const imp = await getImport(s, id);
  if (!imp) notFound();
  const page = parsePage(sp.page);
  const status = ["VALID", "ERROR", "DUPLICATE", "IMPORTED"].includes(sp.status ?? "") ? sp.status : undefined;
  const open = imp.status === "UPLOADED" || imp.status === "VALIDATED";
  const committed = imp.status === "COMMITTED";
  const { rows, total } = open || committed ? await listImportRows(s, id, { status, page }) : { rows: [], total: 0 };
  const depts = new Map((await activeDepartments(s)).map((d) => [d.id, d.code]));
  const sampleRow = open ? (await listImportRows(s, id, { page: 1 })).rows[0]?.raw ?? [] : [];
  const mapping: Mapping = imp.mapping ? ({ ...emptyMapping(), ...imp.mapping } as Mapping) : autoMap(imp.headers);
  const col = (r: { raw: string[] | null }, k: keyof Mapping) => (mapping[k] === null || !r.raw ? "" : r.raw[mapping[k] as number] ?? "");

  const chip = (v: string | undefined, label: string, n?: number) => (
    <Link key={label} href={v ? `/college/students/import/${id}?status=${v}` : `/college/students/import/${id}`} aria-current={(v ?? "") === (status ?? "") ? "page" : undefined}
      className={`rounded-full border px-3 py-1 text-sm ${(v ?? "") === (status ?? "") ? "border-primary bg-primary text-primary-foreground" : "border-border bg-surface hover:bg-background"}`}>{label}{n !== undefined ? ` (${n})` : ""}</Link>
  );

  return (
    <div className="space-y-6">
      <p className="text-sm"><Link href="/college/students/import" className="underline">← Imports</Link></p>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{imp.filename}</h1>
        <StatusBadge value={imp.status} />
        <span className="text-sm text-muted">{imp.total_rows} data row{imp.total_rows === 1 ? "" : "s"}</span>
      </div>

      {imp.status === "CANCELLED" ? <Card><p className="text-sm">This import was cancelled and its uploaded data was deleted. <Link href="/college/students/import" className="underline">Start a new import</Link>.</p></Card> : null}

      {open ? (
        <Card title={imp.status === "UPLOADED" ? "2. Match your columns" : "2. Column mapping"}>
          <MappingForm id={id} headers={imp.headers} sample={sampleRow} initial={mapping} validated={imp.status === "VALIDATED"} />
        </Card>
      ) : null}

      {imp.status === "VALIDATED" ? (
        <>
          <section aria-labelledby="sum" className="space-y-3">
            <h2 id="sum" className="text-lg font-semibold">3. Review before importing</h2>
            <div className="grid gap-4 @xl:grid-cols-3">
              <Stat label="Ready to import" value={imp.valid_rows} testid="stat-ready" />
              <Stat label="Duplicates (skipped)" value={imp.duplicate_rows} testid="stat-duplicates" />
              <Stat label="With problems (skipped)" value={imp.error_rows} testid="stat-problems" />
            </div>
            <p className="text-sm text-muted">Only the rows marked “Ready” will be created. Existing students are never changed. Nothing has been saved yet.</p>
          </section>
          <div className="flex flex-wrap items-start gap-4">
            <CommitForm id={id} ready={imp.valid_rows} />
            <CancelForm id={id} />
            <a href={`/college/students/import/${id}/report`} className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 text-sm font-medium hover:bg-background">Download row report (CSV)</a>
          </div>
        </>
      ) : null}

      {committed ? (
        <section aria-labelledby="res" className="space-y-3">
          <h2 id="res" className="text-lg font-semibold">Result</h2>
          <div className="grid gap-4 @xl:grid-cols-3">
            <Stat label="Students created" value={imp.imported_rows} testid="stat-imported" />
            <Stat label="Duplicates (skipped)" value={imp.duplicate_rows} testid="stat-duplicates" />
            <Stat label="With problems (skipped)" value={imp.error_rows} testid="stat-problems" />
          </div>
          <div className="flex flex-wrap gap-3 text-sm">
            <a href={`/college/students/import/${id}/report`} className="inline-flex h-10 items-center rounded-xl border border-border bg-surface px-4 font-medium hover:bg-background">Download row report (CSV)</a>
            <Link href="/college/students" className="inline-flex h-10 items-center rounded-xl bg-primary px-4 font-medium text-primary-foreground">View students</Link>
          </div>
        </section>
      ) : null}

      {imp.status === "VALIDATED" || committed ? (
        <section aria-labelledby="rows" className="space-y-3">
          <h2 id="rows" className="text-lg font-semibold">Rows</h2>
          <div className="flex flex-wrap gap-2">
            {chip(undefined, "All", imp.total_rows)}
            {committed ? chip("IMPORTED", "Imported", imp.imported_rows) : chip("VALID", "Ready", imp.valid_rows)}
            {chip("DUPLICATE", "Duplicates", imp.duplicate_rows)}
            {chip("ERROR", "Problems", imp.error_rows)}
          </div>
          <Table head={["File row", "Result", "Register no.", "Name", "Department", "Problems"]} empty={rows.length === 0 ? <EmptyState title="No rows" /> : undefined}>
            {rows.map((r) => (
              <tr key={r.row_number}>
                <Td className="tabular-nums">{r.row_number + 1}</Td>
                <Td><StatusBadge value={r.status === "VALID" ? "APPROVED" : r.status === "IMPORTED" ? "APPROVED" : r.status === "DUPLICATE" ? "PENDING" : "REJECTED"} label={RESULT_LABEL[r.status]} /></Td>
                <Td className="font-mono text-xs">{String(r.normalized?.register_number ?? col(r, "register_number"))}</Td>
                <Td>{String(r.normalized?.full_name ?? col(r, "full_name"))}</Td>
                <Td>{r.normalized?.department_id ? depts.get(String(r.normalized.department_id)) ?? "" : col(r, "department")}</Td>
                <Td className="text-sm">{r.errors?.length ? r.errors.join(" ") : <span className="text-muted">—</span>}</Td>
              </tr>
            ))}
          </Table>
          <Pagination page={page} total={total} basePath={`/college/students/import/${id}`} params={{ status }} />
        </section>
      ) : null}
    </div>
  );
}

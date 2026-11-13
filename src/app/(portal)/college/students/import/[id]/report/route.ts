import { NextResponse } from "next/server";
import { toCsv } from "@/lib/csv";
import { uuidSchema } from "@/lib/validation";
import { getSession } from "@/server/auth/session";
import { allImportRows, getImport } from "@/server/students/queries";

export const dynamic = "force-dynamic";

/** Row-by-row result of an import as a CSV. Every cell is passed through csvCell (formula-injection safe). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const s = await getSession();
  if (!s || s.role !== "COLLEGE_ADMIN") return new NextResponse("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const imp = await getImport(s, id);
  if (!imp) return new NextResponse("Not found", { status: 404 });
  const rows = await allImportRows(s, id);
  const header = ["Row", "Result", "Problems", ...imp.headers];
  const body = rows.map((r) => [r.row_number + 1, r.status, (r.errors ?? []).join(" "), ...imp.headers.map((_, i) => r.raw?.[i] ?? "")]);
  const csv = "﻿" + toCsv([header, ...body]);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="import-report-${id.slice(0, 8)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

import { NextResponse } from "next/server";
import { REPORT_TYPES, reportCsv, type ReportType } from "@/lib/reports";
import { allow } from "@/server/auth/rate-limit";
import { candidateSessions } from "@/server/auth/session";
import { exportData, parseYear } from "@/server/reports/queries";

export const dynamic = "force-dynamic";

/** CSV export for placement officers and college administrators. The database authorises (and refuses everyone else); each export is audited. */
export async function GET(req: Request, ctx: { params: Promise<{ type: string }> }) {
  // Exports belong to college staff; use the staff account if this browser has one signed in.
  const sessions = await candidateSessions();
  if (sessions.length === 0) return new NextResponse("Unauthorised", { status: 401 });
  const s = sessions.find((x) => x.role === "PLACEMENT_OFFICER" || x.role === "COLLEGE_ADMIN");
  if (!s) return new NextResponse("Forbidden", { status: 403 });
  const { type } = await ctx.params;
  if (!(REPORT_TYPES as readonly string[]).includes(type)) return new NextResponse("Not found", { status: 404 });
  if (!(await allow("report-export", s.userId, 30, 3600))) return new NextResponse("Too many requests", { status: 429 });
  const year = parseYear(new URL(req.url).searchParams.get("year") ?? undefined);
  let rows: unknown[];
  try {
    rows = await exportData(s, type as ReportType, year);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42501") return new NextResponse("Forbidden", { status: 403 });
    console.error("report export failed:", code, (e as Error).message);
    return new NextResponse("Error", { status: 500 });
  }
  return new NextResponse(reportCsv(type as ReportType, rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campusconnect-${type}-${year ?? "all-years"}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

import { NextResponse } from "next/server";
import { FILTERED_REPORTS, filteredCsv, type FilteredReport } from "@/lib/report-csv";
import { parseFilters } from "@/lib/report-filters";
import { allow } from "@/server/auth/rate-limit";
import { candidateSessions } from "@/server/auth/session";
import { exportReport } from "@/server/reports/filtered";

export const dynamic = "force-dynamic";

/** CSV export for placement officers and college administrators, following the same filters as the page. The database authorises (and refuses everyone else); each export is audited. */
export async function GET(req: Request, ctx: { params: Promise<{ type: string }> }) {
  // Exports belong to college staff; use the staff account if this browser has one signed in.
  const sessions = await candidateSessions();
  if (sessions.length === 0) return new NextResponse("Unauthorised", { status: 401 });
  const s = sessions.find((x) => x.role === "PLACEMENT_OFFICER" || x.role === "COLLEGE_ADMIN");
  if (!s) return new NextResponse("Forbidden", { status: 403 });
  const { type } = await ctx.params;
  if (!(FILTERED_REPORTS as readonly string[]).includes(type)) return new NextResponse("Not found", { status: 404 });
  if (!(await allow("report-export", s.userId, 30, 3600))) return new NextResponse("Too many requests", { status: 429 });
  const f = parseFilters(Object.fromEntries(new URL(req.url).searchParams));
  let data: Awaited<ReturnType<typeof exportReport>>;
  try {
    data = await exportReport(s, type as FilteredReport, f);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42501") return new NextResponse("Forbidden", { status: 403 });
    console.error("report export failed:", code, (e as Error).message);
    return new NextResponse("Error", { status: 500 });
  }
  return new NextResponse(filteredCsv(type as FilteredReport, data), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campusconnect-${type}-${f.year ?? "all-years"}.csv"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

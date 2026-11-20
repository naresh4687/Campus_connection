import { NextResponse } from "next/server";
import { filterRows, parseView, parseWho, participationCsv } from "@/lib/participation";
import { uuidSchema } from "@/lib/validation";
import { allow } from "@/server/auth/rate-limit";
import { candidateSessions } from "@/server/auth/session";
import { logParticipationExport, participation } from "@/server/registrations/queries";

/** The CSV of one drive's students for the signed-in staff member: the database decides what they may see and the download is audited before it is sent. */
export async function participationDownload(req: Request, id: string, roles: string[]) {
  const sessions = await candidateSessions();
  if (sessions.length === 0) return new NextResponse("Unauthorised", { status: 401 });
  const s = sessions.find((x) => roles.includes(x.role));
  if (!s) return new NextResponse("Forbidden", { status: 403 });
  if (!uuidSchema.safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  if (!(await allow("participation-export", s.userId, 30, 3600))) return new NextResponse("Too many requests", { status: 429 });
  const u = new URL(req.url); const view = parseView(u.searchParams.get("view") ?? undefined); const who = parseWho(u.searchParams.get("who") ?? undefined, view);
  const deptRaw = u.searchParams.get("dept") ?? ""; const dept = uuidSchema.safeParse(deptRaw).success ? deptRaw : null;
  try {
    const rows = filterRows(await participation(s, id, dept), view, who);
    await logParticipationExport(s, id, `${view}/${who}`, rows.length);
    return new NextResponse(participationCsv(rows), { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="drive-${view}-${who}.csv"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "42501") return new NextResponse("Forbidden", { status: 403 });
    if (code === "22023") return new NextResponse("Not found", { status: 404 });
    console.error("participation export failed:", code, (e as Error).message);
    return new NextResponse("Error", { status: 500 });
  }
}

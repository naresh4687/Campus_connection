import { NextResponse } from "next/server";
import { allow } from "@/server/auth/rate-limit";
import { getSession } from "@/server/auth/session";
import { exportMyData } from "@/server/privacy/export";

export const dynamic = "force-dynamic";

/** The signed-in student's own data as a JSON file. */
export async function GET() {
  const s = await getSession();
  if (!s || s.role !== "STUDENT") return new NextResponse("Forbidden", { status: 403 });
  if (!(await allow("data-export", s.userId, 10, 3600))) return new NextResponse("Too many requests", { status: 429 });
  let data: Awaited<ReturnType<typeof exportMyData>>;
  try { data = await exportMyData(s); } catch (e) {
    console.error("personal data export failed:", (e as { code?: string }).code, (e as Error).message);
    return new NextResponse("Error", { status: 500 });
  }
  if (!data) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="campusconnect-my-data.json"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
  });
}

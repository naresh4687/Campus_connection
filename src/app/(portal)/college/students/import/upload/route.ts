import { sql } from "kysely";
import { NextResponse } from "next/server";
import { CSV_LIMITS, CsvError, parseCsv } from "@/lib/csv";
import { appBaseUrl } from "@/server/auth/links";
import { allow } from "@/server/auth/rate-limit";
import { assertSameOrigin } from "@/server/auth/request";
import { getSession, withSession } from "@/server/auth/session";

export const dynamic = "force-dynamic";

const back = async (path: string) => NextResponse.redirect(new URL(path, await appBaseUrl()), 303);
const fail = async (msg: string) => back(`/college/students/import?error=${encodeURIComponent(msg)}`);

/** Receives the CSV (multipart). Authorisation, origin, size, encoding and shape are all checked before anything is stored. */
export async function POST(req: Request) {
  try {
    await assertSameOrigin();
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const s = await getSession();
  if (!s || s.role !== "COLLEGE_ADMIN") return new NextResponse("Forbidden", { status: 403 });
  if (!(await allow("csv-upload", s.userId, 20, 3600))) return fail("Too many uploads. Please wait a while and try again.");

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > CSV_LIMITS.bytes + 64 * 1024) return new NextResponse("Payload too large", { status: 413 });

  let file: FormDataEntryValue | null;
  try {
    file = (await req.formData()).get("file");
  } catch {
    return fail("The upload could not be read.");
  }
  if (!(file instanceof File) || file.size === 0) return fail("Choose a CSV file to upload.");
  if (file.size > CSV_LIMITS.bytes) return fail("The file is larger than 2 MB.");

  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(new Uint8Array(await file.arrayBuffer()));
  } catch (e) {
    if (e instanceof CsvError) return fail(e.message);
    throw e;
  }

  const filename = file.name.replace(/^.*[\\/]/, "").replace(/[\u0000-\u001F\u007F]/g, "").slice(0, 200) || "students.csv";
  try {
    const id = await withSession(s, async (t) =>
      (await sql<{ id: string }>`SELECT students.create_import(${filename}, ${JSON.stringify(parsed.headers)}::jsonb, ${JSON.stringify(parsed.rows)}::jsonb) AS id`.execute(t)).rows[0].id);
    return back(`/college/students/import/${id}`);
  } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err.code === "22023" && err.message) return fail(err.message);
    console.error("csv upload failed:", err.code, err.message);
    return fail("The file could not be stored. Please try again.");
  }
}

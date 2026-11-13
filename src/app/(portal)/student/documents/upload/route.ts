import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { NextResponse } from "next/server";
import { MAX_DOCUMENT_BYTES, MAX_DOCUMENT_MB, storageKey, validateUpload } from "@/lib/documents";
import { appBaseUrl } from "@/server/auth/links";
import { allow } from "@/server/auth/rate-limit";
import { assertSameOrigin } from "@/server/auth/request";
import { getSession, withSession } from "@/server/auth/session";
import { deleteObject, putObject } from "@/server/storage/s3";
import { myStudentRecord } from "@/server/students/queries";

export const dynamic = "force-dynamic";

const back = async (qs: string) => NextResponse.redirect(new URL(`/student/documents?${qs}`, await appBaseUrl()), 303);
const fail = (msg: string) => back(`error=${encodeURIComponent(msg)}`);

/**
 * Receives one document. Order matters: authorise -> rate-limit -> size-gate -> read -> validate by CONTENT -> store under a
 * server-generated key -> register in the database (which re-verifies the key belongs to this student). A failure after the
 * object is stored removes it again.
 */
export async function POST(req: Request) {
  try {
    await assertSameOrigin();
  } catch {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const s = await getSession();
  if (!s || s.role !== "STUDENT") return new NextResponse("Forbidden", { status: 403 });
  if (!(await allow("doc-upload", s.userId, 30, 3600))) return fail("Too many uploads. Please wait a while and try again.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_DOCUMENT_BYTES + 64 * 1024) return new NextResponse("Payload too large", { status: 413 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail("The upload could not be read.");
  }
  const file = form.get("file");
  const kind = String(form.get("kind") ?? "");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a file to upload.");
  if (file.size > MAX_DOCUMENT_BYTES) return fail(`The file is larger than ${MAX_DOCUMENT_MB} MB.`);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateUpload({ filename: file.name, declaredType: file.type, bytes, kind });
  if (!check.ok) return fail(check.message);

  const record = await myStudentRecord(s);
  if (!record) return fail("Your student record could not be found. Please contact your college administrator.");
  const key = storageKey(s.collegeId!, record.id, randomUUID());
  const sha = createHash("sha256").update(bytes).digest("hex");

  try {
    await putObject(key, bytes, check.type);
  } catch (e) {
    console.error("document storage failed:", (e as Error).message);
    return fail("The file could not be stored. Please try again.");
  }
  try {
    await withSession(s, (t) => sql`SELECT documents.register(${kind}, ${check.name}, ${check.type}, ${bytes.byteLength}::int, ${sha}, ${key})`.execute(t));
  } catch (e) {
    await deleteObject(key).catch(() => {});
    const err = e as { code?: string; message?: string };
    if (err.code === "22023" && err.message) return fail(err.message);
    console.error("document registration failed:", err.code, err.message);
    return fail("The file could not be saved. Please try again.");
  }
  return back("notice=uploaded");
}

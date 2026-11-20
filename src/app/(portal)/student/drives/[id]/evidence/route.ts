import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { NextResponse } from "next/server";
import { uploadSizeStatus } from "@/lib/upload-size";
import { storageKey } from "@/lib/documents";
import { MAX_EVIDENCE_BYTES, MAX_EVIDENCE_MB, validateEvidence } from "@/lib/evidence";
import { uuidSchema } from "@/lib/validation";
import { appBaseUrl } from "@/server/auth/links";
import { allow } from "@/server/auth/rate-limit";
import { assertSameOrigin } from "@/server/auth/request";
import { getSession, withSession } from "@/server/auth/session";
import { deleteObject, putObject } from "@/server/storage/s3";
import { myStudentRecord } from "@/server/students/queries";

export const dynamic = "force-dynamic";

/**
 * Receives the confirmation screenshot of an external registration. Order: authorise -> rate-limit -> size gate -> read -> validate by CONTENT ->
 * store privately under a server-made key -> let the database record it (it re-checks that the registration is this student's, still open for a
 * screenshot, and that the key is theirs). A failure after the file is stored removes it again. Registration becomes REGISTERED only inside that last step.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try { await assertSameOrigin(); } catch { return new NextResponse("Forbidden", { status: 403 }); }
  const s = await getSession();
  if (!s || s.role !== "STUDENT") return new NextResponse("Forbidden", { status: 403 });
  const { id } = await ctx.params;
  if (!uuidSchema.safeParse(id).success) return new NextResponse("Not found", { status: 404 });
  const back = async (qs: string) => NextResponse.redirect(new URL(`/student/drives/${id}?${qs}`, await appBaseUrl()), 303);
  const fail = (msg: string) => back(`error=${encodeURIComponent(msg)}`);
  if (!(await allow("evidence-upload", s.userId, 20, 3600))) return fail("Too many uploads. Please wait a while and try again.");
  const tooBig = uploadSizeStatus(req.headers.get("content-length"), MAX_EVIDENCE_BYTES + 64 * 1024);
  if (tooBig) return fail(`The screenshot is larger than ${MAX_EVIDENCE_MB} MB. Take it again at a lower size, or crop it.`);

  let form: FormData;
  try { form = await req.formData(); } catch { return fail("The upload could not be read. Please try again."); }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose the screenshot to upload.");
  if (file.size > MAX_EVIDENCE_BYTES) return fail(`The screenshot is larger than ${MAX_EVIDENCE_MB} MB. Take it again at a lower size, or crop it.`);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateEvidence({ filename: file.name, declaredType: file.type, bytes });
  if (!check.ok) return fail(check.message);

  const record = await myStudentRecord(s);
  if (!record) return fail("Your student record could not be found. Please contact your college administrator.");
  const key = storageKey(s.collegeId!, record.id, randomUUID());
  const sha = createHash("sha256").update(bytes).digest("hex");
  try { await putObject(key, bytes, check.type); } catch (e) { console.error("evidence storage failed:", (e as Error).message); return fail("The screenshot could not be stored. Please try again."); }
  try {
    await withSession(s, (t) => sql`SELECT registrations.submit_evidence(${id}::uuid, ${key}, ${check.name}, ${check.type}, ${bytes.byteLength}::int, ${sha})`.execute(t));
  } catch (e) {
    await deleteObject(key).catch(() => {});
    const err = e as { code?: string; message?: string };
    if (err.code === "22023" && err.message) return fail(err.message);
    console.error("evidence registration failed:", err.code, err.message);
    return fail("The screenshot could not be saved. Please try again.");
  }
  return back("notice=evidence-submitted");
}

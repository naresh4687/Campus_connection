import { createHash, randomUUID } from "node:crypto";
import { sql } from "kysely";
import { NextResponse } from "next/server";
import { MAX_DOCUMENT_BYTES, validateUpload } from "@/lib/documents";
import { offerFileKey } from "@/lib/offers";
import { uuidSchema } from "@/lib/validation";
import { appBaseUrl } from "../auth/links";
import { allow } from "../auth/rate-limit";
import { assertSameOrigin } from "../auth/request";
import { getSession, withSession } from "../auth/session";
import { deleteObject, putObject } from "../storage/s3";

/** Shared upload pipeline for offer letters (officers) and joining proofs (students): authorise -> rate-limit -> size-gate -> validate content -> store under a server key -> register (the database re-checks everything). */
export async function handleOfferUpload(req: Request, selectionId: string, kind: "OFFER_LETTER" | "JOINING_PROOF", backTo: (qs: string) => string): Promise<NextResponse> {
  const back = async (qs: string) => NextResponse.redirect(new URL(backTo(qs), await appBaseUrl()), 303);
  const fail = (m: string) => back(`error=${encodeURIComponent(m)}`);
  try { await assertSameOrigin(); } catch { return new NextResponse("Forbidden", { status: 403 }); }
  const s = await getSession();
  const need = kind === "OFFER_LETTER" ? "PLACEMENT_OFFICER" : "STUDENT";
  if (!s || s.role !== need || !s.collegeId) return new NextResponse("Forbidden", { status: 403 });
  if (!uuidSchema.safeParse(selectionId).success) return new NextResponse("Not found", { status: 404 });
  if (!(await allow("offer-upload", s.userId, 40, 3600))) return fail("Too many uploads. Please wait a while and try again.");
  if (Number(req.headers.get("content-length") ?? 0) > MAX_DOCUMENT_BYTES + 64 * 1024) return new NextResponse("Payload too large", { status: 413 });
  let form: FormData;
  try { form = await req.formData(); } catch { return fail("The upload could not be read."); }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("Choose a file to upload.");
  if (file.size > MAX_DOCUMENT_BYTES) return fail("The file is larger than 5 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const check = validateUpload({ filename: file.name, declaredType: file.type, bytes, kind: "OTHER" });
  if (!check.ok) return fail(check.message);
  const key = offerFileKey(s.collegeId, selectionId, randomUUID());
  const sha = createHash("sha256").update(bytes).digest("hex");
  try { await putObject(key, bytes, check.type); } catch (e) { console.error("offer file storage failed:", (e as Error).message); return fail("The file could not be stored. Please try again."); }
  try {
    await withSession(s, (t) => sql`SELECT offers.register_file(${selectionId}::uuid, ${kind}, ${check.name}, ${check.type}, ${bytes.byteLength}::int, ${sha}, ${key})`.execute(t));
  } catch (e) {
    await deleteObject(key).catch(() => {});
    const err = e as { code?: string; message?: string };
    if (err.code === "22023" && err.message) return fail(err.message);
    if (err.code === "42501") return new NextResponse("Forbidden", { status: 403 });
    console.error("offer file registration failed:", err.code, err.message);
    return fail("The file could not be saved. Please try again.");
  }
  return back(kind === "OFFER_LETTER" ? "notice=letter" : "notice=proof");
}

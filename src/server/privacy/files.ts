import { sql } from "kysely";
import { withSession, type SessionUser } from "../auth/session";
import { deleteObject } from "../storage/s3";

/** Removes an erased student's files from storage, marking each only once it is gone. Returns how many are still there. */
export async function removeErasedFiles(s: SessionUser, requestId: string): Promise<number> {
  const keys = await withSession(s, async (t) => (await sql<{ storage_key: string }>`SELECT * FROM privacy.erasure_files(${requestId}::uuid)`.execute(t)).rows);
  let left = 0;
  for (const { storage_key } of keys) {
    try {
      await deleteObject(storage_key);
      await withSession(s, (t) => sql`SELECT privacy.mark_file_erased(${requestId}::uuid, ${storage_key})`.execute(t));
    } catch (e) {
      left++;
      console.error("erased file removal failed:", (e as Error).message);
    }
  }
  return left;
}

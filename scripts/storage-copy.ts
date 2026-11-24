import "dotenv/config";
import { GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

/**
 * One-off: copies every object from one S3-compatible bucket to another (for example Neon Object Storage -> Cloudflare R2), keeping the same keys,
 * so the database rows that point at them keep working. Source and destination are given in the environment; nothing is deleted from the source.
 *
 *   SRC_S3_ENDPOINT SRC_S3_REGION SRC_S3_BUCKET SRC_S3_ACCESS_KEY SRC_S3_SECRET_KEY
 *   DEST_S3_ENDPOINT DEST_S3_REGION DEST_S3_BUCKET DEST_S3_ACCESS_KEY DEST_S3_SECRET_KEY
 *   npx tsx scripts/storage-copy.ts            (add --dry-run to only count)
 */
const need = (k: string) => { const v = process.env[k]; if (!v) { console.error(`${k} is not set`); process.exit(1); } return v; };
const make = (p: "SRC" | "DEST") => new S3Client({
  endpoint: need(`${p}_S3_ENDPOINT`), region: process.env[`${p}_S3_REGION`] ?? "us-east-1", forcePathStyle: true,
  credentials: { accessKeyId: need(`${p}_S3_ACCESS_KEY`), secretAccessKey: need(`${p}_S3_SECRET_KEY`) },
  requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED",
});

async function main() {
  const dry = process.argv.includes("--dry-run");
  const src = make("SRC"); const dest = make("DEST"); const sb = need("SRC_S3_BUCKET"); const db = need("DEST_S3_BUCKET");
  let token: string | undefined; let copied = 0; let bytes = 0;
  do {
    const page = await src.send(new ListObjectsV2Command({ Bucket: sb, ContinuationToken: token }));
    for (const o of page.Contents ?? []) {
      if (!o.Key) continue;
      if (!dry) {
        const got = await src.send(new GetObjectCommand({ Bucket: sb, Key: o.Key }));
        const body = await got.Body!.transformToByteArray();
        await dest.send(new PutObjectCommand({ Bucket: db, Key: o.Key, Body: body, ContentType: got.ContentType, CacheControl: "private, no-store" }));
      }
      copied++; bytes += o.Size ?? 0;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  console.log(`${dry ? "would copy" : "copied"} ${copied} object(s), ${(bytes / 1048576).toFixed(1)} MB`);
}
main().catch((e) => { console.error("copy failed:", e.message); process.exit(1); });

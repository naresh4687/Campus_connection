import { randomUUID } from "node:crypto";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { beforeAll, describe, expect, it } from "vitest";
import { storageConfig } from "../../src/server/config";
import { deleteObject, ensureBucket, putObject, signedDownloadUrl } from "../../src/server/storage/s3";

// Requires the dev object store (docker compose up -d storage). These tests prove the properties the document feature relies on.
const key = () => `c/${randomUUID()}/s/${randomUUID()}/${randomUUID()}`;
const body = new TextEncoder().encode("%PDF-1.7 private bytes %%EOF");
const objectUrl = (k: string) => `${storageConfig().endpoint}/${storageConfig().bucket}/${k}`;

beforeAll(async () => { await ensureBucket(); });

describe("private object storage", () => {
  it("ensureBucket is idempotent", async () => { await ensureBucket(); await ensureBucket(); });

  it("objects are NOT readable anonymously", async () => {
    const k = key(); await putObject(k, body, "application/pdf");
    expect((await fetch(objectUrl(k))).status).toBe(403);
    await deleteObject(k);
  });

  it("a signed link downloads the file as an opaque attachment with the stored content type", async () => {
    const k = key(); await putObject(k, body, "application/pdf");
    const url = await signedDownloadUrl(k, 'Sem "5" marks.pdf', "application/pdf");
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(/^attachment;/);
    expect(res.headers.get("content-disposition")).not.toMatch(/"5"/);           // quotes in the name are neutralised
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode(await res.arrayBuffer())).toContain("private bytes");
    await deleteObject(k);
  });

  it("links are short-lived (60 s) and the provider enforces expiry", async () => {
    const k = key(); await putObject(k, body, "application/pdf");
    expect(new URL(await signedDownloadUrl(k, "a.pdf", "application/pdf")).searchParams.get("X-Amz-Expires")).toBe("60");
    const c = storageConfig();
    const short = await getSignedUrl(new S3Client({ endpoint: c.endpoint, region: c.region, forcePathStyle: true, credentials: { accessKeyId: c.accessKey, secretAccessKey: c.secretKey } }), new GetObjectCommand({ Bucket: c.bucket, Key: k }), { expiresIn: 2 });
    expect((await fetch(short)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 3500));
    expect((await fetch(short)).status).toBe(403);
    await deleteObject(k);
  });

  it("a link cannot be re-pointed at another object", async () => {
    const a = key(); const b = key(); await putObject(a, body, "application/pdf"); await putObject(b, body, "application/pdf");
    const url = await signedDownloadUrl(a, "a.pdf", "application/pdf");
    expect((await fetch(url.replace(a, b))).status).toBe(403);
    await deleteObject(a); await deleteObject(b);
  });

  it("deleting removes the object for good", async () => {
    const k = key(); await putObject(k, body, "application/pdf");
    await deleteObject(k);
    expect((await fetch(await signedDownloadUrl(k, "a.pdf", "application/pdf"))).status).toBe(404);
    await deleteObject(k);       // deleting a missing object is not an error
  });
});

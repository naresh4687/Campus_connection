import { createHash, createHmac, randomBytes } from "node:crypto";

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** 256-bit random, URL-safe. Shown to the user once; only its SHA-256 is stored. */
export const newToken = () => randomBytes(32).toString("base64url");

export const isWellFormedToken = (t: unknown): t is string => typeof t === "string" && TOKEN_RE.test(t);

export const hashToken = (token: string): Buffer => createHash("sha256").update(token).digest();

/** Keyed hash for rate-limit keys / audit fields, so raw emails and IPs never sit in those tables. */
export const hmac = (pepper: string, value: string) => createHmac("sha256", pepper).update(value).digest("hex");

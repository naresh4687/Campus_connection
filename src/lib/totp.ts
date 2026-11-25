/** Time-based one-time passwords (RFC 6238: HMAC-SHA1, 30-second steps, 6 digits), as authenticator apps implement them. Server only. */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const STEP_SECONDS = 30;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xffffff; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  return bits ? out + B32[(value << (5 - bits)) & 31] : out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0, value = 0; const out: number[] = [];
  for (const c of text.toUpperCase().replace(/[\s=-]/g, "")) {
    const i = B32.indexOf(c);
    if (i < 0) throw new Error("not base32");
    value = ((value << 5) | i) & 0xffffff; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(randomBytes(20));

export function totpAt(secret: string, step: number, digits = 6): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const o = mac[mac.length - 1] & 15;
  return String((mac.readUInt32BE(o) & 0x7fffffff) % 10 ** digits).padStart(digits, "0");
}

export const stepOf = (ms: number) => Math.floor(ms / 1000 / STEP_SECONDS);

/** The time step a code belongs to (one step of clock drift either way), newer than `afterStep` so a code works only once; otherwise null. */
export function matchTotp(secret: string, code: string, now = Date.now(), afterStep = 0): number | null {
  const given = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return null;
  const current = stepOf(now);
  for (const step of [current - 1, current, current + 1]) {
    if (step > afterStep && timingSafeEqual(Buffer.from(totpAt(secret, step)), Buffer.from(given))) return step;
  }
  return null;
}

/** Ten one-time codes like "K7QD2-M9XPA" (50 random bits each). */
export const newRecoveryCodes = (n = 10) => Array.from({ length: n }, () => base32Encode(randomBytes(7)).slice(0, 10).replace(/^(.{5})/, "$1-"));
export const normalizeRecoveryCode = (v: string) => v.toUpperCase().replace(/[^A-Z2-7]/g, "");

export const otpauthUrl = (secret: string, account: string, issuer = "CampusConnect") =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

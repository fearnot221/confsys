import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
// AES-256-GCM with per-record nonce and authenticated record ID/version.
export function seal(
  value: string,
  id: string,
  key: string,
  version: string,
): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
  cipher.setAAD(Buffer.from(`${id}:${version}`));
  const encrypted = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64");
}
export function unseal(
  value: string,
  id: string,
  key: string,
  version: string,
): string {
  const bytes = Buffer.from(value, "base64");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(key, "hex"),
    bytes.subarray(0, 12),
  );
  decipher.setAuthTag(bytes.subarray(12, 28));
  decipher.setAAD(Buffer.from(`${id}:${version}`));
  return Buffer.concat([
    decipher.update(bytes.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

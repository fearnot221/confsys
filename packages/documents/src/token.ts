import { createHash, createHmac } from "node:crypto";
export function passToken(tokenId: string, key: string) {
  return `cs1_${createHmac("sha256", Buffer.from(key, "hex")).update(`confsys:onsite:v1:${tokenId}`).digest("base64url")}`;
}
export const passHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

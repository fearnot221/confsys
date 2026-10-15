import { passHash, passToken } from "../packages/documents/src/token.js";
type TokenRow = { token_id: string; token_hash: string };
export function verifyRestoredQrTokens(
  source: TokenRow[],
  restored: TokenRow[],
  sourceKey: string,
  restoredKey: string,
  requiredFixtureHash?: string,
) {
  if (source.length > 1000 || restored.length > 1000)
    throw new Error("QR recovery sample exceeds bound");
  const classify = (rows: TokenRow[], key: string) =>
    rows
      .map((row) => ({
        ...row,
        valid: passHash(passToken(row.token_id, key)) === row.token_hash,
      }))
      .sort((a, b) => a.token_id.localeCompare(b.token_id));
  const before = classify(source, sourceKey),
    after = classify(restored, restoredKey);
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Recovered QR rows or key validity differ from source");
  if (
    requiredFixtureHash &&
    !after.some((row) => row.valid && row.token_hash === requiredFixtureHash)
  )
    throw new Error("Enriched QR fixture is not valid with recovered key");
  return {
    valid: after.filter((row) => row.valid).length,
    stale: after.filter((row) => !row.valid).length,
  };
}

import { expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { verifyRestoredQrTokens } from "../../scripts/restore-qr-check.js";
import { passHash, passToken } from "../../packages/documents/src/token.js";
const key = "a".repeat(64),
  oldKey = "b".repeat(64);
const row = (signingKey: string) => {
  const token_id = randomUUID();
  return { token_id, token_hash: passHash(passToken(token_id, signingKey)) };
};
it("preserves legitimate stale rows but requires current enriched fixture MAC", () => {
  const valid = row(key),
    stale = row(oldKey),
    rows = [valid, stale];
  expect(
    verifyRestoredQrTokens(rows, [stale, valid], key, key, valid.token_hash),
  ).toEqual({ valid: 1, stale: 1 });
  expect(() =>
    verifyRestoredQrTokens(rows, rows, key, key, stale.token_hash),
  ).toThrow("Enriched QR fixture");
});
it("rejects restored key, token, hash, and sample mismatches", () => {
  const valid = row(key),
    rows = [valid];
  expect(() => verifyRestoredQrTokens(rows, rows, key, oldKey)).toThrow(
    "differ",
  );
  expect(() =>
    verifyRestoredQrTokens(
      rows,
      [{ ...valid, token_id: randomUUID() }],
      key,
      key,
    ),
  ).toThrow("differ");
  expect(() =>
    verifyRestoredQrTokens(
      rows,
      [{ ...valid, token_hash: "0".repeat(64) }],
      key,
      key,
    ),
  ).toThrow("differ");
  expect(() => verifyRestoredQrTokens(rows, [], key, key)).toThrow("differ");
  expect(() =>
    verifyRestoredQrTokens([], [], key, key, valid.token_hash),
  ).toThrow("Enriched QR fixture");
  expect(() =>
    verifyRestoredQrTokens(Array(1001).fill(valid), [], key, key),
  ).toThrow("bound");
});
it("reports empty non-enriched legacy drills without claiming QR evidence", () => {
  expect(verifyRestoredQrTokens([], [], key, key)).toEqual({
    valid: 0,
    stale: 0,
  });
});

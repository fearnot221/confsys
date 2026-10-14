import argon2 from "argon2";
import { randomBytes } from "node:crypto";
import { passwordSchema } from "@confsys/contracts";
import { AuthError } from "./errors.js";
export const passwordOptions = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;
export const hashPassword = (value: string) =>
  argon2.hash(value, passwordOptions);
export const verifyPassword = (hash: string, value: string) =>
  argon2.verify(hash, value);
// Random dummy credential follows the same Argon2 path for unknown/pending users.
export const dummyHash = hashPassword(randomBytes(32).toString("hex"));
const blocked = new Set([
  "passwordpassword",
  "password123456789",
  "123456789012345",
  "1234567890123456",
  "qwertyuiopasdfgh",
  "letmeinletmeinletmein",
  "correct horse battery staple",
]);
export function assertPassword(value: string, email?: string) {
  const normalized = value.toLowerCase();
  if (
    !passwordSchema.safeParse(value).success ||
    blocked.has(normalized) ||
    /^(.{1,4})\1+$/u.test(value) ||
    /^(password|qwerty|letmein|welcome|admin|confsys)[\d\W_]*$/iu.test(value) ||
    (email && (normalized === email || normalized === email.split("@")[0]))
  )
    throw new AuthError("WEAK_PASSWORD");
}

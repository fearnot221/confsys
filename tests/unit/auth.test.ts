import { it, expect } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import {
  loadApiConfig,
  loadWorkerConfig,
  loadMigrationConfig,
  diagnostic,
} from "@confsys/config";
import { seal, unseal } from "@confsys/notifications";
import {
  assertPassword,
  hashPassword,
  verifyPassword,
} from "../../apps/api/src/auth/password.js";
import { cookiePolicy } from "../../apps/api/src/auth/routes.js";
import { emailSchema } from "@confsys/contracts";
const key = randomBytes(32).toString("hex");
export const settings = {
  DATABASE_URL: "postgres://app@localhost/db",
  REDIS_URL: "redis://localhost",
  WORKER_HEALTH_URL: "http://localhost",
  PUBLIC_APP_ORIGIN: "http://127.0.0.1:25173",
  MAIL_ENCRYPTION_KEY: key,
  MAIL_KEY_VERSION: "v1",
  QR_SIGNING_KEY: key,
  CSRF_SIGNING_KEY: key,
};
it("separates process configuration, validates origins and production cookie policy", () => {
  const api = loadApiConfig({
    ...settings,
    MIGRATION_DATABASE_URL: "postgres://supersecret@localhost/db",
    QR_SIGNING_KEY: key,
    WORKER_DATABASE_URL: "postgres://worker@localhost/db",
  });
  expect(api).not.toHaveProperty("MIGRATION_DATABASE_URL");
  expect(api).not.toHaveProperty("WORKER_DATABASE_URL");
  const worker = loadWorkerConfig({
    QR_SIGNING_KEY: key,
    WORKER_DATABASE_URL: "postgres://worker@localhost/db",
    REDIS_URL: "redis://localhost",
    MAIL_ENCRYPTION_KEY: key,
    MAIL_KEY_VERSION: "v1",
  });
  expect(worker).not.toHaveProperty("DATABASE_URL");
  expect(worker).not.toHaveProperty("CSRF_SIGNING_KEY");
  expect(
    loadMigrationConfig({ MIGRATION_DATABASE_URL: "postgres://localhost/db" }),
  ).not.toHaveProperty("REDIS_URL");
  expect(() => loadApiConfig({ ...settings, NODE_ENV: "production" })).toThrow(
    "PUBLIC_APP_ORIGIN",
  );
  for (const origin of [
    "http://example.com",
    "https://example.com/path",
    "https://user:pass@example.com",
    "https://example.com?return=evil",
  ])
    expect(() =>
      loadApiConfig({ ...settings, PUBLIC_APP_ORIGIN: origin }),
    ).toThrow();
  const production = loadApiConfig({
    ...settings,
    NODE_ENV: "production",
    PUBLIC_APP_ORIGIN: "https://conferences.example",
  });
  expect(cookiePolicy(production)).toMatchObject({
    name: "__Host-session",
    options: { secure: true, httpOnly: true, path: "/", sameSite: "lax" },
  });
  expect(cookiePolicy(api)).toMatchObject({
    name: "dev-session",
    options: { secure: false },
  });
  expect(() =>
    loadWorkerConfig({
      ...Object.fromEntries(
        Object.entries(worker).map(([k, v]) => [k, String(v)]),
      ),
      SMTP_HOST: "smtp.real-provider.com",
    }),
  ).toThrow();
});
it("uses Argon2id, preserves Unicode/spaces, bounds work and rejects weak passwords", async () => {
  const password = "  會議研究者 使用安全密碼 phrases  ";
  assertPassword(password);
  const hash = await hashPassword(password);
  expect(hash).toMatch(/^\$argon2id\$v=19\$/);
  expect(hash.split("$")[3]?.split(",").sort()).toEqual([
    "m=19456",
    "p=1",
    "t=2",
  ]);
  expect(await verifyPassword(hash, password)).toBe(true);
  expect(await verifyPassword(hash, password.trim())).toBe(false);
  for (const value of [
    "short",
    "a".repeat(20),
    "passwordpassword",
    "x".repeat(129),
    "研究".repeat(129),
  ])
    expect(() => assertPassword(value)).toThrow();
  expect(() =>
    assertPassword("研究句子安全的長密碼可使用空白".repeat(4)),
  ).not.toThrow();
  expect(emailSchema.parse("  Someone+tag@Example.COM ")).toBe(
    "someone+tag@example.com",
  );
});
it("authenticates encrypted delivery secrets against ID, version, key and tampering", () => {
  const id = randomUUID(),
    raw = "secret-token-value";
  const encrypted = seal(raw, id, key, "v1");
  expect(encrypted).not.toContain(raw);
  expect(unseal(encrypted, id, key, "v1")).toBe(raw);
  for (const [otherId, otherKey, version] of [
    [randomUUID(), key, "v1"],
    [id, randomBytes(32).toString("hex"), "v1"],
    [id, key, "v2"],
  ])
    expect(() => unseal(encrypted, otherId!, otherKey!, version!)).toThrow();
  const damaged = Buffer.from(encrypted, "base64");
  damaged[30] = damaged[30]! ^ 1;
  expect(() => unseal(damaged.toString("base64"), id, key, "v1")).toThrow();
});
it("safe diagnostics accept only correlation context", () => {
  const output: string[] = [];
  const original = console.error;
  console.error = (value: string) => output.push(value);
  try {
    diagnostic("worker", "queue_unavailable", { eventId: "event", attempt: 2 });
  } finally {
    console.error = original;
  }
  expect(JSON.parse(output[0]!)).toEqual({
    service: "worker",
    event: "queue_unavailable",
    eventId: "event",
    attempt: 2,
  });
});

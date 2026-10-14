import { Writable } from "node:stream";
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { buildApp } from "../../apps/api/src/app.js";
import {
  registerAuthRoutes,
  cookiePolicy,
} from "../../apps/api/src/auth/routes.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createRateLimiter } from "../../apps/api/src/auth/rate-limit.js";
import { authFixture, password } from "../helpers/auth.js";
import { errorSchema, accountSchema } from "@confsys/contracts";
const f = authFixture(),
  service = createAuthService(f.app, f.config);
const redis = new Redis(f.config.REDIS_URL, {
  maxRetriesPerRequest: 0,
  enableOfflineQueue: false,
});
const namespace = `auth-http-${randomUUID()}`;
const limit = createRateLimiter(redis, f.config.CSRF_SIGNING_KEY, namespace);
const up = async () => {};
const app = buildApp({ postgres: up, redis: up, worker: up });
let cookie = "",
  csrf = "";
const post = (
  path: string,
  payload: Record<string, string>,
  extra: Record<string, string> = {},
) =>
  app.inject({
    method: "POST",
    url: `/api/auth/${path}`,
    payload,
    headers: {
      origin: f.config.PUBLIC_APP_ORIGIN,
      "x-csrf-token": csrf,
      cookie,
      ...extra,
    },
  });
beforeAll(async () => {
  f.migrate();
  if (redis.status !== "ready")
    await new Promise<void>((resolve) => redis.once("ready", resolve));
  await registerAuthRoutes(app, { config: f.config, service, limit });
  const response = await app.inject("/api/auth/csrf");
  cookie = response.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  csrf = response.json().csrfToken;
});
afterAll(async () => {
  for (const key of await redis.keys(`${namespace}:*`)) await redis.del(key);
  redis.disconnect();
  await app.close();
  await f.cleanup();
});
it("anonymous CSRF bootstrap works; wrong/missing token and external Origin fail before mutations", async () => {
  const email = f.email();
  for (const headers of [
    { "x-csrf-token": "" },
    { "x-csrf-token": "wrong" },
    { origin: "https://evil.example" },
    { origin: "" },
  ]) {
    const response = await post("register", { email }, headers);
    expect(response.statusCode).toBe(403);
    expect(errorSchema.parse(response.json()).error.code).toBe("CSRF_REJECTED");
  }
  expect((await post("register", { email })).statusCode).toBe(202);
  const get = await app.inject("/api/auth/verify?token=secret");
  expect(get.statusCode).toBe(404);
  expect(get.body).not.toContain("secret");
  const csrfCookie = (await app.inject("/api/auth/csrf")).cookies[0]!;
  expect(csrfCookie.httpOnly).toBe(true);
  expect(csrfCookie.path).toBe("/");
});
it("anonymous outcomes do not enumerate accounts and errors retain HTTP meaning", async () => {
  const email = f.email();
  await service.requestMail("register", email, randomUUID());
  const known = await post("forgot", { email }),
    unknown = await post("forgot", { email: f.email() });
  expect(known.statusCode).toBe(202);
  expect(known.body).toBe(unknown.body);
  for (const address of [email, f.email()]) {
    const response = await post("login", { email: address, password });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe("INVALID_CREDENTIALS");
  }
  expect((await post("login", { email: "bad", password })).statusCode).toBe(
    400,
  );
  const me = await app.inject("/api/auth/me");
  expect(me.statusCode).toBe(401);
  expect(me.headers["cache-control"]).toBe("no-store");
});
it("real Redis per-account/source limits fail closed; queue/rate failure does not block sessions or logout", async () => {
  const email = f.email();
  await service.requestMail("register", email, randomUUID());
  await service.consume(
    "verify",
    (await f.link(email)).token,
    password,
    randomUUID(),
  );
  const login = await post(
    "login",
    { email, password },
    { cookie: `${cookie}; ${cookiePolicy(f.config).name}=prelogin-attacker` },
  );
  expect(login.statusCode).toBe(200);
  expect(accountSchema.parse(login.json()).user.email).toBe(email);
  expect(login.body).not.toContain("token");
  expect(login.body).not.toContain("hash");
  const session = login.cookies.find(
    (c) => c.name === cookiePolicy(f.config).name,
  )!;
  expect(session.value).not.toBe("prelogin-attacker");
  expect(session.httpOnly).toBe(true);
  expect(session.sameSite).toBe("Lax");
  expect(session.domain).toBeUndefined();
  const authenticated = `${cookie}; ${session.name}=${session.value}`;
  for (let i = 0; i < 5; i++)
    await limit("verification", `source-${i}`, "same-account");
  await expect(
    limit("verification", "new-source", "same-account"),
  ).rejects.toMatchObject({ code: "RATE_LIMITED" });
  for (let i = 0; i < 100; i++)
    await limit("login", "single-source", `account-${i}`);
  await expect(limit("login", "single-source", "extra")).rejects.toMatchObject({
    code: "RATE_LIMITED",
  });
  // Actual Redis connection is disconnected: no fallback to unlimited auth operations.
  redis.disconnect();
  const failed = await post("forgot", { email });
  expect(failed.statusCode).toBe(503);
  expect(
    (
      await app.inject({
        url: "/api/auth/me",
        headers: { cookie: authenticated },
      })
    ).statusCode,
  ).toBe(200);
  expect((await post("logout", {}, { cookie: authenticated })).statusCode).toBe(
    200,
  );
  expect(
    (
      await app.inject({
        url: "/api/auth/me",
        headers: { cookie: authenticated },
      })
    ).statusCode,
  ).toBe(401);
  await redis.connect();
});
it("API logs omit passwords, tokens, sensitive URLs and raw errors", async () => {
  const lines: string[] = [];
  const destination = new Writable({
    write(chunk, _encoding, done) {
      lines.push(String(chunk));
      done();
    },
  });
  const logApp = buildApp({ postgres: up, redis: up, worker: up }, destination);
  logApp.post("/test-secret-error", async () => {
    throw new Error("postgres://sensitive-dsn password=hidden");
  });
  const response = await logApp.inject({
    method: "POST",
    url: "/test-secret-error?token=private-token",
    headers: { cookie: "session=private-cookie" },
    payload: { password: "private-password", token: "private-body-token" },
  });
  expect(response.statusCode).toBe(500);
  expect(response.body).not.toMatch(/sensitive-dsn|private-token|hidden/);
  await logApp.close();
  expect(lines.length).toBeGreaterThan(0);
  expect(lines.join("")).not.toMatch(
    /sensitive-dsn|private-token|hidden|private-cookie|private-password|private-body-token/,
  );
});
it("DB outage cannot authenticate from stale state and returns safe 503", async () => {
  const { createPool } = await import("@confsys/db");
  const url = new URL(f.config.DATABASE_URL);
  url.port = "1";
  const pool = createPool(url.href);
  const unavailable = createAuthService(pool, f.config);
  const server = buildApp({ postgres: up, redis: up, worker: up });
  await registerAuthRoutes(server, {
    config: f.config,
    service: unavailable,
    limit,
  });
  try {
    const result = await server.inject({
      url: "/api/auth/me",
      headers: { cookie: `dev-session=${"a".repeat(43)}` },
    });
    expect(result.statusCode).toBe(503);
    expect(result.body).not.toContain(url.href);
  } finally {
    await server.close();
    await pool.end();
  }
});

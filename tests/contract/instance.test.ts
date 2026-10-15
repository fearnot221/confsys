import { it, expect } from "vitest";
import { loadApiConfig } from "@confsys/config";
import { createClient } from "@confsys/sdk";
import { buildApp } from "../../apps/api/src/app.js";
import { registerInstanceRoute } from "../../apps/api/src/instance.js";
const settings = {
  DATABASE_URL: "postgres://app@localhost/db",
  REDIS_URL: "redis://localhost",
  WORKER_HEALTH_URL: "http://localhost",
  PUBLIC_APP_ORIGIN: "http://a.localhost:35173",
  MAIL_ENCRYPTION_KEY: "a".repeat(64),
  MAIL_KEY_VERSION: "v1",
  QR_SIGNING_KEY: "c".repeat(64),
  CSRF_SIGNING_KEY: "b".repeat(64),
  CONFERENCE_NAME: "Synthetic A",
};
it("serves only explicit runtime display configuration through SDK; rejects forged Host", async () => {
  const up = async () => {};
  const app = buildApp({ postgres: up, redis: up, worker: up });
  registerInstanceRoute(app, loadApiConfig(settings), async () => ({
    conferenceName: settings.CONFERENCE_NAME,
  }));
  try {
    const sdk = createClient("", async (input) => {
      const res = await app.inject({
        url: String(input),
        headers: { host: "a.localhost:35173" },
      });
      return new Response(res.body, { status: res.statusCode });
    });
    expect(await sdk.getInstance()).toEqual({ conferenceName: "Synthetic A" });
    expect(
      (
        await app.inject({
          url: "/api/instance",
          headers: { host: "evil.invalid" },
        })
      ).statusCode,
    ).toBe(403);
    await expect(
      createClient(
        "",
        async () =>
          new Response(
            JSON.stringify({ conferenceName: "A", DATABASE_URL: "secret" }),
          ),
      ).getInstance(),
    ).rejects.toThrow();
  } finally {
    await app.close();
  }
});
it("accepts explicit local hostnames only for development and rejects malformed origins/names", () => {
  expect(loadApiConfig(settings).PUBLIC_APP_ORIGIN).toBe(
    settings.PUBLIC_APP_ORIGIN,
  );
  for (const origin of [
    "http://localhost.evil",
    "https://a.example/#x",
    "https://a.example/",
    "https://user@a.example",
    "https://a.example?x=1",
  ])
    expect(() =>
      loadApiConfig({ ...settings, PUBLIC_APP_ORIGIN: origin }),
    ).toThrow();
  expect(() =>
    loadApiConfig({ ...settings, NODE_ENV: "production" }),
  ).toThrow();
  expect(() =>
    loadApiConfig({ ...settings, CONFERENCE_NAME: "A\nInjected" }),
  ).toThrow();
});

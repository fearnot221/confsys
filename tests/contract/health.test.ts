import { it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import {
  readinessSchema,
  liveSchema,
  errorSchema,
  openApiDocument,
} from "@confsys/contracts";
import { createClient } from "@confsys/sdk";
import { buildApp } from "../../apps/api/src/app.js";
const up = async () => {};
it("committed OpenAPI exactly matches developer-owned contract schemas", async () => {
  expect(
    JSON.parse(await readFile("packages/contracts/openapi.json", "utf8")),
  ).toEqual(openApiDocument());
});
it("Fastify responses and SDK agree on 200, 503 and errors", async () => {
  let down = false;
  const app = buildApp({
    postgres: up,
    redis: up,
    worker: async () => {
      if (down) throw new Error("unavailable");
    },
  });
  const transport: typeof fetch = async (input) => {
    const result = await app.inject(String(input));
    return new Response(result.body, {
      status: result.statusCode,
      headers: { "content-type": "application/json" },
    });
  };
  const sdk = createClient("", transport);
  try {
    expect(
      liveSchema.parse((await app.inject("/api/health/live")).json()).status,
    ).toBe("alive");
    expect(readinessSchema.parse(await sdk.getReadiness()).status).toBe(
      "ready",
    );
    down = true;
    expect((await sdk.getReadiness()).status).toBe("not_ready");
    expect(
      errorSchema.parse((await app.inject("/no-such-route")).json()).error.code,
    ).toBe("NOT_FOUND");
  } finally {
    await app.close();
  }
});
it("SDK rejects invalid DTOs and mismatched readiness HTTP statuses", async () => {
  await expect(
    createClient(
      "",
      async () =>
        new Response(JSON.stringify({ status: "ready", private: "hidden" })),
    ).getReadiness(),
  ).rejects.toThrow();
  const body = {
    status: "not_ready",
    dependencies: { postgres: "down", redis: "up", worker: "up" },
  };
  await expect(
    createClient(
      "",
      async () => new Response(JSON.stringify(body), { status: 200 }),
    ).getReadiness(),
  ).rejects.toThrow("INVALID_RESPONSE");
});

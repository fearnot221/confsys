import { it, expect } from "vitest";
import {
  accountSchema,
  authOperations,
  errorSchema,
  errorStatuses,
  openApiDocument,
} from "@confsys/contracts";
import { createAuthClient } from "@confsys/sdk";
import { buildApp } from "../../apps/api/src/app.js";
import { AuthError } from "../../apps/api/src/auth/errors.js";
const up = async () => {};
it("auth OpenAPI includes every operation; DTOs reject credential and role leakage", () => {
  const paths = openApiDocument().paths;
  for (const spec of Object.values(authOperations))
    expect(paths).toHaveProperty(spec.path);
  expect(
    accountSchema.safeParse({
      user: {
        id: "121ad20d-dc9b-4edf-ac0d-f101956b54b4",
        email: "a@example.invalid",
        verified: true,
        password_hash: "private",
      },
    }).success,
  ).toBe(false);
});
it("typed errors retain 400/401/403/429/503 rather than collapsing into 400 or 500", async () => {
  const app = buildApp({ postgres: up, redis: up, worker: up });
  for (const code of [
    "INVALID_TOKEN",
    "INVALID_CREDENTIALS",
    "CSRF_REJECTED",
    "RATE_LIMITED",
    "SERVICE_UNAVAILABLE",
  ] as const)
    app.get(`/test/${code}`, async () => {
      throw new AuthError(code);
    });
  try {
    for (const code of [
      "INVALID_TOKEN",
      "INVALID_CREDENTIALS",
      "CSRF_REJECTED",
      "RATE_LIMITED",
      "SERVICE_UNAVAILABLE",
    ] as const) {
      const result = await app.inject(`/test/${code}`);
      expect(result.statusCode).toBe(errorStatuses[code]);
      expect(errorSchema.parse(result.json()).error.code).toBe(code);
    }
  } finally {
    await app.close();
  }
});
it("SDK bootstraps CSRF, preserves safe error codes, never sends tokens in query strings", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createAuthClient("", async (input, init) => {
    calls.push({ url: String(input), init });
    if (String(input).endsWith("/csrf"))
      return Response.json({ csrfToken: "csrf-value" });
    return Response.json(
      {
        error: {
          code: "INVALID_CREDENTIALS",
          message: "Invalid",
          requestId: "request",
        },
      },
      { status: 401 },
    );
  });
  await expect(
    client.mutate("login", { email: "a@example.invalid", password: "secret" }),
  ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
  expect(calls.map((c) => c.url)).toEqual([
    "/api/auth/csrf",
    "/api/auth/login",
  ]);
  expect(calls[1]?.init).toMatchObject({
    credentials: "same-origin",
    cache: "no-store",
    headers: { "x-csrf-token": "csrf-value" },
  });
  await expect(
    createAuthClient("", async () =>
      Response.json({ user: { email: "private" } }),
    ).me(),
  ).rejects.toThrow();
});
it("framework rejection statuses preserve payload-size and media-type meaning", async () => {
  const app = buildApp({ postgres: up, redis: up, worker: up });
  app.post("/input", async () => ({ ok: true }));
  try {
    const large = await app.inject({
      method: "POST",
      url: "/input",
      payload: { data: "x".repeat(17000) },
    });
    expect(large.statusCode).toBe(413);
    expect(large.json().error.code).toBe("REQUEST_TOO_LARGE");
    const media = await app.inject({
      method: "POST",
      url: "/input",
      headers: { "content-type": "application/unknown" },
      payload: "value",
    });
    expect(media.statusCode).toBe(415);
  } finally {
    await app.close();
  }
});

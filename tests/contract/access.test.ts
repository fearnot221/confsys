import { it, expect } from "vitest";
import {
  accessEndpoints,
  directoryAccountSchema,
  accountSchema,
  openApiDocument,
} from "@confsys/contracts";
import { createAuthClient } from "@confsys/sdk";
it("access OpenAPI covers every endpoint and only explicit projections parse", () => {
  for (const spec of Object.values(accessEndpoints))
    expect(openApiDocument().paths).toHaveProperty(
      spec.path.replace(":id", "{id}"),
    );
  const user = {
    id: "121ad20d-dc9b-4edf-ac0d-f101956b54b4",
    email: "a@example.invalid",
    verified: true,
    roles: ["conference_staff"],
    state: "active",
  };
  expect(directoryAccountSchema.safeParse(user).success).toBe(true);
  for (const field of [
    "password_hash",
    "token_hash",
    "credential_version",
    "raw_session",
  ])
    expect(
      directoryAccountSchema.safeParse({ ...user, [field]: "secret" }).success,
    ).toBe(false);
  expect(
    accountSchema.safeParse({
      user: {
        id: user.id,
        email: user.email,
        verified: true,
        roles: [],
        permissions: ["*"],
      },
    }).success,
  ).toBe(false);
});
it("access SDK uses bounded GET and CSRF protected explicit operations with strict result parsing", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createAuthClient("", async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(
      String(url).endsWith("csrf")
        ? { csrfToken: "synthetic" }
        : { changed: true },
    );
  });
  await expect(
    client.manage(
      "121ad20d-dc9b-4edf-ac0d-f101956b54b4",
      { action: "disable", reason: "synthetic test" },
      new AbortController().signal,
    ),
  ).resolves.toEqual({ changed: true });
  expect(calls[1]?.init).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "x-csrf-token": "synthetic" },
  });
  await expect(
    createAuthClient("", async () =>
      Response.json({ items: [{ password_hash: "secret" }], nextOffset: null }),
    ).directory({}, new AbortController().signal),
  ).rejects.toThrow();
});

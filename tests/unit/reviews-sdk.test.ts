import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createReviewClient } from "../../packages/sdk/src/reviews.js";
import { reviewFormDocumentSchema } from "@confsys/contracts";

it("preserves legacy review form snapshots without silently requiring new screening", () => {
  const legacy = {
    name: "Legacy rubric",
    mode: "double_blind",
    closesAt: "2099-01-01T00:00:00.000Z",
    criteria: [{ id: "quality", label: "Quality", max: 5 }],
  };
  expect(reviewFormDocumentSchema.parse(legacy).requireScreening).toBe(false);
  expect(legacy).not.toHaveProperty("requireScreening");
  expect(
    reviewFormDocumentSchema.parse({ ...legacy, requireScreening: true })
      .requireScreening,
  ).toBe(true);
});

it("validates reminder commands before transport and preserves CSRF, cancellation and safe server errors", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const requestId = randomUUID();
  const client = createReviewClient("", async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return url === "/api/auth/csrf"
      ? new Response(JSON.stringify({ csrfToken: "synthetic-csrf" }))
      : new Response(
          JSON.stringify({
            error: { code: "CONFLICT", message: "Conflict", requestId },
          }),
          { status: 409 },
        );
  });
  const signal = new AbortController().signal;
  const data = {
    assignmentId: randomUUID(),
    idempotencyKey: randomUUID(),
    reason: "Pending review reminder",
  };
  await expect(
    client.remind({ ...data, reason: "" }, signal),
  ).rejects.toThrow();
  expect(calls).toHaveLength(0);
  await expect(client.remind(data, signal)).rejects.toMatchObject({
    code: "CONFLICT",
    status: 409,
    requestId,
  });
  expect(calls).toHaveLength(2);
  expect(calls[1]).toMatchObject({
    url: "/api/reviews/remind",
    init: {
      method: "POST",
      signal,
      cache: "no-store",
      credentials: "same-origin",
      headers: { "x-csrf-token": "synthetic-csrf" },
      body: JSON.stringify(data),
    },
  });
});

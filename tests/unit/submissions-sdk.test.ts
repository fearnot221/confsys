import { it, expect } from "vitest";
import { createSubmissionClient } from "../../packages/sdk/src/submissions.js";
import { randomUUID } from "node:crypto";
it("submission SDK encodes bounded history query, forwards abort and validates failures", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createSubmissionClient("", async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        error: {
          code: "NOT_FOUND",
          message: "NOT_FOUND",
          requestId: randomUUID(),
        },
      }),
      { status: 404, headers: { "content-type": "application/json" } },
    );
  });
  const signal = new AbortController().signal,
    id = randomUUID();
  await expect(
    client(
      "submissionDetail",
      { id, scope: "own", revisionOffset: 20 },
      signal,
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  expect(calls[0]!.url).toBe(
    `/api/submissions/detail?id=${id}&scope=own&revisionOffset=20`,
  );
  expect(calls[0]!.init).toMatchObject({
    credentials: "same-origin",
    cache: "no-store",
    signal,
  });
  await expect(
    client(
      "submissionDetail",
      { id, scope: "own", revisionOffset: -1 },
      signal,
    ),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
});

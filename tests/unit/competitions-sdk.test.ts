import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { createCompetitionClient } from "../../packages/sdk/src/competitions.js";
it("encodes bounded pages and preserves safe errors and cancellation", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [],
    client = createCompetitionClient("", async (input, init) => {
      calls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          error: {
            code: "NOT_FOUND",
            message: "Not found",
            requestId: randomUUID(),
          },
        }),
        { status: 404 },
      );
    }),
    signal = new AbortController().signal;
  await expect(
    client("competitionJudging", { offset: 20 }, signal),
  ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  expect(calls[0]).toMatchObject({
    url: "/api/competitions/judging?offset=20",
    init: { signal, cache: "no-store", credentials: "same-origin" },
  });
  await expect(
    client("competitionJudging", { offset: -1 }, signal),
  ).rejects.toThrow();
  expect(calls).toHaveLength(1);
});
it("sends explicit successor identity and optimistic version with CSRF and validates lineage output", async () => {
  const previous = randomUUID(),
    revision = randomUUID();
  const result = {
    id: randomUUID(),
    competitionId: randomUUID(),
    submissionId: randomUUID(),
    revisionId: revision,
    ownerId: randomUUID(),
    version: 1,
    state: "requested",
    title: "Replacement",
    presenterName: "Presenter",
    predecessorId: previous,
    replacementReason: "Approved change",
    reason: "",
  };
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createCompetitionClient("", async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify(
        String(input).endsWith("/csrf") ? { csrfToken: "test-token" } : result,
      ),
    );
  });
  const request = {
    predecessorId: previous,
    expectedVersion: 3,
    revisionId: revision,
    reason: "Approved change",
  };
  expect(
    await client(
      "competitionReplaceEntry",
      request,
      new AbortController().signal,
    ),
  ).toEqual(result);
  expect(calls[1]).toMatchObject({
    url: "/api/competitions/replace-entry",
    init: {
      method: "POST",
      headers: { "x-csrf-token": "test-token" },
      body: JSON.stringify(request),
    },
  });
  await expect(
    client(
      "competitionReplaceEntry",
      { ...request, expectedVersion: -1 },
      new AbortController().signal,
    ),
  ).rejects.toThrow();
  expect(calls).toHaveLength(2);
});

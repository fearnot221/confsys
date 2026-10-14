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

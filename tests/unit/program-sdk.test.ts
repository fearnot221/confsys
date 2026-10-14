import { expect, it } from "vitest";
import { createProgramClient } from "../../packages/sdk/src/program.js";
it("personal schedule uses the authenticated no-store read and rejects private DTO drift", async () => {
  const signal = new AbortController().signal;
  const calls: { url: string; init?: RequestInit }[] = [];
  let leak = false;
  const client = createProgramClient("", async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(
      JSON.stringify({
        publicationId: null,
        publishedAt: null,
        sessions: [],
        ...(leak ? { ownerId: "private-owner" } : {}),
      }),
    );
  });
  expect(await client("programMine", null, signal)).toEqual({
    publicationId: null,
    publishedAt: null,
    sessions: [],
  });
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({
    url: "/api/program/mine",
    init: { signal, credentials: "same-origin", cache: "no-store" },
  });
  leak = true;
  await expect(client("programMine", null, signal)).rejects.toThrow();
});

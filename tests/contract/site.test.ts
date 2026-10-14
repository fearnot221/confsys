import { it, expect } from "vitest";
import { createAuthClient, ApiError } from "@confsys/sdk";
import {
  openApiDocument,
  siteDraftSchema,
  publicSiteSchema,
} from "@confsys/contracts";
import { completeSite } from "../helpers/site.js";
it("site contract includes both GET and POST draft and excludes administrative fields from public DTO", () => {
  const doc = openApiDocument();
  expect(doc.paths).toHaveProperty(["/api/site/draft", "get"]);
  expect(doc.paths).toHaveProperty(["/api/site/draft", "post"]);
  const value = {
    publicationId: null,
    conferenceName: "A",
    document: completeSite(),
  };
  expect(publicSiteSchema.parse(value)).toEqual(value);
  for (const extra of [
    { publishedBy: "private" },
    { draftVersion: 1 },
    { SMTP_FROM: "private" },
    { session: "private" },
  ])
    expect(publicSiteSchema.safeParse({ ...value, ...extra }).success).toBe(
      false,
    );
});
it("SDK uses existing CSRF transport, strict document and version, and preserves conflict code", async () => {
  const draft = {
    draftVersion: 1,
    document: completeSite(),
    activePublicationId: null,
    publishedDraftVersion: null,
  };
  const calls: { path: string; init: RequestInit }[] = [];
  const client = createAuthClient("", async (input, init) => {
    const path = String(input);
    calls.push({ path, init: init ?? {} });
    return new Response(
      JSON.stringify(
        path.endsWith("csrf") ? { csrfToken: "synthetic" } : draft,
      ),
    );
  });
  expect(
    siteDraftSchema.parse(
      await client.site(
        "siteSave",
        { expectedVersion: 0, document: draft.document },
        new AbortController().signal,
      ),
    ),
  ).toEqual(draft);
  expect(calls.map((c) => c.path)).toEqual([
    "/api/auth/csrf",
    "/api/site/draft",
  ]);
  expect(calls[1]!.init).toMatchObject({
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: { "x-csrf-token": "synthetic" },
  });
  const conflict = createAuthClient(
    "",
    async () =>
      new Response(
        JSON.stringify({
          error: {
            code: "CONFLICT",
            message: "CONFLICT",
            requestId: "synthetic",
          },
        }),
        { status: 409 },
      ),
  );
  await expect(
    conflict.site("siteDraft", null, new AbortController().signal),
  ).rejects.toBeInstanceOf(ApiError);
});

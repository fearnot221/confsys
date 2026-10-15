import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  notificationAudienceInput,
  notificationBatchInput,
  notificationTemplateInput,
} from "@confsys/contracts";
import { createNotificationBatchClient } from "../../packages/sdk/src/notification-batches.js";
it("preserves legacy immediate batches while validating bounded explicit audience and template content", () => {
  const base = {
    idempotencyKey: randomUUID(),
    recipientIds: [randomUUID()],
    subject: "Synthetic notice",
    text: "Generic notice",
  };
  expect(notificationBatchInput.parse(base)).toMatchObject({
    audience: null,
    templateVersionId: null,
    scheduledAt: null,
  });
  expect(() =>
    notificationBatchInput.parse({
      ...base,
      recipientIds: [...base.recipientIds, ...base.recipientIds],
    }),
  ).toThrow();
  expect(() =>
    notificationBatchInput.parse({ ...base, subject: "Header\nInjected" }),
  ).toThrow();
  expect(() =>
    notificationAudienceInput.parse({
      role: null,
      registration: "any",
      submission: "any",
      publishedOutcome: "unpublished",
    }),
  ).toThrow();
  expect(() =>
    notificationTemplateInput.parse({
      id: randomUUID(),
      key: "bad key",
      expectedVersion: 0,
      name: "Template",
      subject: "Notice",
      text: "Text",
    }),
  ).toThrow();
});
it("audience preview uses CSRF and private transport while rejecting unexpected projected identity fields", async () => {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const client = createNotificationBatchClient("", async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    return new Response(
      JSON.stringify(
        url === "/api/auth/csrf"
          ? { csrfToken: "synthetic" }
          : {
              items: [
                {
                  id: randomUUID(),
                  email: "local@example.invalid",
                  privateReview: "must not leak",
                },
              ],
              total: 1,
              truncated: false,
            },
      ),
    );
  });
  const signal = new AbortController().signal;
  await expect(
    client.preview(
      {
        role: null,
        registration: "any",
        submission: "any",
        publishedOutcome: "any",
      },
      signal,
    ),
  ).rejects.toThrow();
  expect(calls[1]).toMatchObject({
    url: "/api/notifications/audience-preview",
    init: {
      method: "POST",
      signal,
      credentials: "same-origin",
      cache: "no-store",
      headers: { "x-csrf-token": "synthetic" },
    },
  });
});

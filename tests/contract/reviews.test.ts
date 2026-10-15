import { it, expect } from "vitest";
import { reviewEndpoints } from "@confsys/contracts";
import { randomUUID } from "node:crypto";
it("batch result release accepts only bounded unique explicit decision identities", () => {
  const input = reviewEndpoints.reviewPublishBatch.input,
    id = randomUUID();
  expect(input.safeParse({ ids: [id] }).success).toBe(true);
  for (const bad of [
    { ids: [] },
    { ids: [id, id] },
    { ids: Array.from({ length: 51 }, () => randomUUID()) },
    { ids: [id], publishAll: true },
    { ids: [id], actorId: randomUUID() },
  ])
    expect(input.safeParse(bad).success).toBe(false);
});

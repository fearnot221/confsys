import { it, expect } from "vitest";
import {
  assertInterval,
  contains,
  assertIdKind,
} from "../../apps/api/src/program/policy.js";
import type { ProgramDraft } from "@confsys/contracts";
import { randomUUID } from "node:crypto";
it("intervals are positive and slots must fit entirely within their session", () => {
  expect(() =>
    assertInterval("2026-10-15T01:00:00Z", "2026-10-15T01:00:00Z"),
  ).toThrow();
  expect(() =>
    assertInterval("2026-10-15T02:00:00Z", "2026-10-15T01:00:00Z"),
  ).toThrow();
  const session = {
    startsAt: "2026-10-15T01:00:00Z",
    endsAt: "2026-10-15T02:00:00Z",
  };
  expect(contains(session, session)).toBe(true);
  expect(
    contains(session, { ...session, endsAt: "2026-10-15T02:00:00.001Z" }),
  ).toBe(false);
});
it("resource ids cannot be reused across schedule entity types", () => {
  const id = randomUUID(),
    draft: ProgramDraft = {
      version: 0,
      rooms: [
        {
          id,
          name: "Synthetic room",
          venue: "Synthetic venue",
          bufferMinutes: 0,
        },
      ],
      blocked: [],
      sessions: [],
      slots: [],
      activePublicationId: null,
    };
  expect(() => assertIdKind(draft, id, "room")).not.toThrow();
  for (const kind of ["blocked", "session", "slot"] as const)
    expect(() => assertIdKind(draft, id, kind)).toThrow();
});

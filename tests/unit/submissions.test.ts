import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  submissionDocumentSchema,
  submissionSaveInput,
  submissionConfigSchema,
  type SubmissionConfig,
  type SubmissionDocument,
} from "@confsys/contracts";
import {
  assertSubmissionWindow,
  assertSubmissionConfig,
  assertSubmissionDocument,
} from "../../apps/api/src/submissions/policy.js";
const config: SubmissionConfig = {
  version: 1,
  opensAt: "2026-10-15T00:00:00Z",
  closesAt: "2026-10-16T00:00:00Z",
  requireRegistration: false,
  requireAttachment: false,
  tracks: [
    {
      id: "science",
      name: "Science",
      topics: [{ id: "physics", name: "Physics" }],
    },
  ],
};
const doc: SubmissionDocument = {
  title: "Synthetic research",
  abstract: "Synthetic abstract",
  trackId: "science",
  topicIds: ["physics"],
  authors: [
    {
      name: "Synthetic Author",
      email: "author@example.invalid",
      affiliation: "Synthetic Institute",
    },
  ],
  presenterIndex: 0,
  presentationPreference: "either",
  competition: false,
  attachmentIds: [],
  slidesFileId: null,
  videoUrl: "",
};
describe("submission server policy", () => {
  it("opens inclusively, closes exclusively and denies unconfigured windows", () => {
    for (const at of [
      "2026-10-14T23:59:59.999Z",
      "2026-10-16T00:00:00Z",
      "2026-10-16T00:00:00.001Z",
    ])
      expect(() => assertSubmissionWindow(config, new Date(at))).toThrow();
    for (const at of ["2026-10-15T00:00:00Z", "2026-10-15T23:59:59.999Z"])
      expect(() => assertSubmissionWindow(config, new Date(at))).not.toThrow();
    expect(() =>
      assertSubmissionWindow(
        { ...config, opensAt: null, closesAt: null },
        new Date(),
      ),
    ).toThrow();
  });
  it("rejects inverted/missing windows and duplicate track/topic ids", () => {
    expect(() => assertSubmissionConfig(config)).not.toThrow();
    for (const value of [
      { ...config, closesAt: null },
      { ...config, closesAt: config.opensAt },
      { ...config, tracks: [...config.tracks, ...config.tracks] },
      {
        ...config,
        tracks: [
          {
            ...config.tracks[0]!,
            topics: [
              { id: "same", name: "A" },
              { id: "same", name: "B" },
            ],
          },
        ],
      },
    ])
      expect(() => assertSubmissionConfig(value)).toThrow();
  });
  it("drafts tolerate incomplete content while submission validates authors, presenter, track and topic", () => {
    expect(() => assertSubmissionDocument(doc, config, true)).not.toThrow();
    for (const invalid of [
      { ...doc, title: "" },
      { ...doc, abstract: "" },
      { ...doc, trackId: "absent" },
      { ...doc, topicIds: ["absent"] },
      { ...doc, authors: [] },
      { ...doc, authors: [{ ...doc.authors[0]!, email: "" }] },
      { ...doc, presenterIndex: 1 },
    ]) {
      expect(() => assertSubmissionDocument(invalid, config, true)).toThrow();
      expect(() =>
        assertSubmissionDocument(invalid, config, false),
      ).not.toThrow();
    }
    expect(() =>
      assertSubmissionDocument(
        doc,
        { ...config, requireAttachment: true },
        true,
      ),
    ).toThrow();
  });
  it("refuses duplicated attachment ids, topic ids and unsafe video URLs", () => {
    const id = randomUUID();
    for (const invalid of [
      { ...doc, attachmentIds: [id, id] },
      { ...doc, attachmentIds: [id], slidesFileId: id },
      { ...doc, topicIds: ["physics", "physics"] },
      ...[
        "http://example.invalid",
        "javascript:alert(1)",
        "https://user:secret@example.invalid",
        "nonsense",
      ].map((videoUrl) => ({ ...doc, videoUrl })),
    ])
      expect(() => assertSubmissionDocument(invalid, config, false)).toThrow();
    expect(() =>
      assertSubmissionDocument(
        { ...doc, videoUrl: "https://example.invalid/video" },
        config,
        false,
      ),
    ).not.toThrow();
  });
  it("bounded strict contracts do not accept caller ownership, state or account linkage", () => {
    expect(
      submissionSaveInput.safeParse({
        id: randomUUID(),
        expectedVersion: 0,
        document: doc,
        ownerId: randomUUID(),
      }).success,
    ).toBe(false);
    expect(
      submissionDocumentSchema.safeParse({
        ...doc,
        authors: [{ ...doc.authors[0], userId: randomUUID() }],
      }).success,
    ).toBe(false);
    expect(
      submissionDocumentSchema.safeParse({ ...doc, title: "x".repeat(501) })
        .success,
    ).toBe(false);
    expect(
      submissionConfigSchema.safeParse({
        ...config,
        opensAt: "2026-01-01T00:00:00",
      }).success,
    ).toBe(false);
  });
});

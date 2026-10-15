import { it, expect } from "vitest";
import {
  validateCompetition,
  scoreDocument,
  equalTotal,
  beforeDeadline,
} from "../../apps/api/src/competitions/policy.js";
import type { CompetitionConfig } from "@confsys/contracts";
const config: CompetitionConfig = {
  name: "Synthetic",
  kind: "oral",
  registrationClosesAt: "2030-01-01T00:00:00Z",
  judgingClosesAt: "2030-01-02T00:00:00Z",
  requireRegistration: false,
  minimumJudges: 1,
  tiePolicy: "shared",
  eligibilityNote: "Accepted",
  criteria: [
    { id: "a", label: "A", maximum: 10, weight: 2 },
    { id: "b", label: "B", maximum: 20, weight: 1 },
  ],
};
it("validates unique criteria and server deadlines", () => {
  expect(() =>
    validateCompetition({
      ...config,
      judgingClosesAt: config.registrationClosesAt,
    }),
  ).toThrow();
  expect(() =>
    validateCompetition({
      ...config,
      criteria: [config.criteria[0]!, config.criteria[0]!],
    }),
  ).toThrow();
  expect(() =>
    beforeDeadline(
      config.registrationClosesAt,
      new Date(config.registrationClosesAt),
    ),
  ).toThrow();
});
it("scores weighted integer points and normalizes criterion ordering; incomplete drafts remain incomplete", () => {
  expect(
    scoreDocument(
      config,
      {
        scores: [
          { criterionId: "b", value: 10 },
          { criterionId: "a", value: 8 },
        ],
        comment: "",
      },
      true,
    ),
  ).toMatchObject({
    points: 26,
    maximum: 40,
    document: {
      scores: [
        { criterionId: "a", value: 8 },
        { criterionId: "b", value: 10 },
      ],
    },
  });
  expect(
    scoreDocument(config, { scores: [], comment: "" }, false).document.scores,
  ).toEqual([]);
  for (const scores of [
    [],
    [
      { criterionId: "a", value: 11 },
      { criterionId: "b", value: 2 },
    ],
    [
      { criterionId: "a", value: 1 },
      { criterionId: "a", value: 2 },
    ],
    [{ criterionId: "unknown", value: 1 }],
  ])
    expect(() =>
      scoreDocument(config, { scores, comment: "" }, true),
    ).toThrow();
});
it("compares exact rational totals rather than rounded display", () => {
  expect(
    equalTotal(
      { numerator: "1", denominator: "3" },
      { numerator: "2", denominator: "6" },
    ),
  ).toBe(true);
  expect(
    equalTotal(
      { numerator: "33333", denominator: "100000" },
      { numerator: "1", denominator: "3" },
    ),
  ).toBe(false);
});

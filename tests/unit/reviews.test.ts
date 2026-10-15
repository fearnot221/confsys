import { it, expect } from "vitest";
import { validateReviewScores } from "../../apps/api/src/reviews/policy.js";
import type { ReviewFormDocument } from "@confsys/contracts";
const form: ReviewFormDocument = {
  name: "Synthetic",
  requireScreening: false,
  mode: "double_blind",
  closesAt: "2099-01-01T00:00:00.000Z",
  criteria: [
    { id: "quality", label: "Quality", max: 5 },
    { id: "relevance", label: "Relevance", max: 3 },
  ],
};
it("draft may omit criteria; final submission requires every configured score and author comment", () => {
  expect(() =>
    validateReviewScores(
      { scores: [], authorComment: "", privateComment: "" },
      form,
      false,
    ),
  ).not.toThrow();
  expect(() =>
    validateReviewScores(
      { scores: [], authorComment: "", privateComment: "" },
      form,
      true,
    ),
  ).toThrow();
  expect(() =>
    validateReviewScores(
      {
        scores: [
          { criterionId: "quality", value: 5 },
          { criterionId: "relevance", value: 3 },
        ],
        authorComment: "Useful feedback",
        privateComment: "Internal",
      },
      form,
      true,
    ),
  ).not.toThrow();
});
it("rubric limits, unknown criteria and duplicate scores cannot become valid reviews", () => {
  for (const scores of [
    [{ criterionId: "quality", value: 6 }],
    [{ criterionId: "quality", value: -1 }],
    [{ criterionId: "unknown", value: 1 }],
    [
      { criterionId: "quality", value: 1 },
      { criterionId: "quality", value: 2 },
    ],
  ])
    expect(() =>
      validateReviewScores(
        { scores, authorComment: "Feedback", privateComment: "" },
        form,
        false,
      ),
    ).toThrow();
});

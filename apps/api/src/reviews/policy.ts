import type {
  ReviewScoreDocument,
  ReviewFormDocument,
} from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
export function validateReviewScores(
  document: ReviewScoreDocument,
  form: ReviewFormDocument,
  complete: boolean,
) {
  const seen = new Set<string>();
  for (const score of document.scores) {
    const criterion = form.criteria.find((c) => c.id === score.criterionId);
    if (
      !criterion ||
      seen.has(score.criterionId) ||
      score.value < 0 ||
      score.value > criterion.max
    )
      throw new AuthError("INVALID_REQUEST");
    seen.add(score.criterionId);
  }
  if (
    complete &&
    (seen.size !== form.criteria.length || !document.authorComment.trim())
  )
    throw new AuthError("INVALID_REQUEST");
}

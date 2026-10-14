import type { CompetitionConfig, CompetitionScore } from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
export function validateCompetition(config: CompetitionConfig) {
  if (
    Date.parse(config.registrationClosesAt) >=
      Date.parse(config.judgingClosesAt) ||
    new Set(config.criteria.map((c) => c.id)).size !== config.criteria.length
  )
    throw new AuthError("INVALID_REQUEST");
}
export function scoreDocument(
  config: CompetitionConfig,
  document: CompetitionScore,
  submit: boolean,
) {
  const ids = document.scores.map((s) => s.criterionId);
  if (
    new Set(ids).size !== ids.length ||
    ids.some((id) => !config.criteria.some((c) => c.id === id)) ||
    (submit && ids.length !== config.criteria.length)
  )
    throw new AuthError("INVALID_REQUEST");
  let points = 0,
    maximum = 0;
  for (const criterion of config.criteria) {
    const score = document.scores.find((s) => s.criterionId === criterion.id);
    if (score && score.value > criterion.maximum)
      throw new AuthError("INVALID_REQUEST");
    points += (score?.value ?? 0) * criterion.weight;
    maximum += criterion.maximum * criterion.weight;
  }
  return {
    document: {
      scores: config.criteria.flatMap((c) =>
        document.scores.filter((s) => s.criterionId === c.id),
      ),
      comment: document.comment,
    },
    points,
    maximum,
  };
}
export function equalTotal(
  a: { numerator: string; denominator: string },
  b: { numerator: string; denominator: string },
) {
  return (
    BigInt(a.numerator) * BigInt(b.denominator) ===
    BigInt(b.numerator) * BigInt(a.denominator)
  );
}
export function beforeDeadline(deadline: string, now = new Date()) {
  if (now.getTime() >= Date.parse(deadline)) throw new AuthError("CONFLICT");
}

import type {
  SubmissionConfig,
  SubmissionDocument,
  Submission,
} from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
export function assertSubmissionWindow(config: SubmissionConfig, now: Date) {
  if (
    !config.opensAt ||
    !config.closesAt ||
    now.getTime() < Date.parse(config.opensAt) ||
    now.getTime() >= Date.parse(config.closesAt)
  )
    throw new AuthError("CONFLICT");
}
export function assertSubmissionVersion(
  submission: Submission,
  expected: number,
) {
  if (submission.version !== expected) throw new AuthError("CONFLICT");
}
export function assertSubmissionConfig(config: SubmissionConfig) {
  if (
    (config.opensAt === null) !== (config.closesAt === null) ||
    (config.opensAt &&
      config.closesAt &&
      Date.parse(config.opensAt) >= Date.parse(config.closesAt))
  )
    throw new AuthError("INVALID_REQUEST");
  if (
    config.acceptedRegistrationDeadline &&
    (!config.closesAt ||
      Date.parse(config.acceptedRegistrationDeadline) <=
        Date.parse(config.closesAt))
  )
    throw new AuthError("INVALID_REQUEST");
  const ids = config.tracks.map((t) => t.id);
  if (
    new Set(ids).size !== ids.length ||
    config.tracks.some(
      (t) => new Set(t.topics.map((v) => v.id)).size !== t.topics.length,
    )
  )
    throw new AuthError("INVALID_REQUEST");
}
export function assertSubmissionDocument(
  document: SubmissionDocument,
  config: SubmissionConfig,
  submitting: boolean,
) {
  const ids = [
    ...document.attachmentIds,
    ...(document.slidesFileId ? [document.slidesFileId] : []),
  ];
  if (
    new Set(ids).size !== ids.length ||
    new Set(document.topicIds).size !== document.topicIds.length
  )
    throw new AuthError("INVALID_REQUEST");
  if (document.videoUrl) {
    let url: URL;
    try {
      url = new URL(document.videoUrl);
    } catch {
      throw new AuthError("INVALID_REQUEST");
    }
    if (url.protocol !== "https:" || url.username || url.password)
      throw new AuthError("INVALID_REQUEST");
  }
  if (!submitting) return;
  const track = config.tracks.find((t) => t.id === document.trackId);
  if (
    !track ||
    !document.title ||
    !document.abstract ||
    !document.authors.length ||
    document.presenterIndex >= document.authors.length ||
    document.correspondingAuthorIndex === null ||
    document.correspondingAuthorIndex >= document.authors.length ||
    document.authors.some((a) => !a.name || !a.email || !a.affiliation) ||
    document.topicIds.some((id) => !track.topics.some((t) => t.id === id)) ||
    ((config.requireAttachment || config.mode === "full_paper") &&
      !document.attachmentIds.length)
  )
    throw new AuthError("INVALID_REQUEST");
}

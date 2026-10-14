import { assertReadyOwnedFiles, referenceFiles } from "../files/repository.js";
import type { SubmissionDependencies } from "./service.js";
// Registration and file ownership are checked in the same transaction as submission.
// No actor or registration identifier is accepted from browser content.
export const submissionDependencies: SubmissionDependencies = {
  async isRegistered(db, actorId) {
    return !!(
      await db.query(
        "SELECT 1 FROM confsys.registrations WHERE user_id=$1 AND state='confirmed'",
        [actorId],
      )
    ).rowCount;
  },
  async assertFiles(db, actorId, document) {
    await assertReadyOwnedFiles(
      db,
      actorId,
      document.attachmentIds,
      "manuscript",
    );
    if (document.slidesFileId)
      await assertReadyOwnedFiles(
        db,
        actorId,
        [document.slidesFileId],
        "manuscript",
      );
  },
  async referenceFiles(db, document, revisionId) {
    await referenceFiles(
      db,
      [
        ...document.attachmentIds,
        ...(document.slidesFileId ? [document.slidesFileId] : []),
      ],
      "submission_revision",
      revisionId,
    );
  },
};

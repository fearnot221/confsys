import {
  assertReadyOwnedFiles,
  referenceFiles,
  findFile,
} from "../files/repository.js";
import { AuthError } from "../auth/errors.js";
import type { SubmissionDependencies } from "./service.js";
// Registration and file ownership are checked in the same transaction as submission.
// No actor or registration identifier is accepted from browser content.
export const submissionDependencies: SubmissionDependencies = {
  async activeRevisionRequest(db, submission) {
    if (!submission.currentRevisionId || submission.state !== "submitted")
      return null;
    // A superseded publication cannot silently retain an extension. Lock the exact request
    // while the submission is locked; review publication uses the same access fence.
    const result = await db.query<{ id: string }>(
      `SELECT r.id FROM confsys.submission_revision_requests r JOIN confsys.review_publications p ON p.decision_id=r.decision_id WHERE r.submission_id=$1 AND r.revision_id=$2 AND r.new_revision_id IS NULL AND r.published_at<=clock_timestamp() AND r.deadline>clock_timestamp() ORDER BY r.published_at DESC,r.id LIMIT 1 FOR UPDATE OF r`,
      [submission.id, submission.currentRevisionId],
    );
    return result.rows[0]?.id ?? null;
  },
  async fulfillRevisionRequest(db, requestId, revisionId) {
    await db.query(
      "UPDATE confsys.submission_revision_requests SET new_revision_id=$2 WHERE id=$1 AND new_revision_id IS NULL",
      [requestId, revisionId],
    );
  },
  async isRegistered(db, actorId) {
    return !!(
      await db.query(
        "SELECT 1 FROM confsys.registrations WHERE user_id=$1 AND state='confirmed'",
        [actorId],
      )
    ).rowCount;
  },
  async assertFiles(db, actorId, document, requireFullPaper = false) {
    await assertReadyOwnedFiles(
      db,
      actorId,
      document.attachmentIds,
      "manuscript",
    );
    if (requireFullPaper) {
      let hasPdf = false;
      for (const id of document.attachmentIds)
        if ((await findFile(db, id)).media_type === "application/pdf")
          hasPdf = true;
      if (!hasPdf) throw new AuthError("INVALID_REQUEST");
    }
    if (document.slidesFileId) {
      await assertReadyOwnedFiles(
        db,
        actorId,
        [document.slidesFileId],
        "manuscript",
      );
      if (
        (await findFile(db, document.slidesFileId)).media_type !==
        "application/pdf"
      )
        throw new AuthError("INVALID_REQUEST");
    }
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

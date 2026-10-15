import {
  readinessSchema,
  publicInstanceSchema,
  errorSchema,
  routes,
  type Readiness,
} from "@confsys/contracts";
import { ApiError } from "./errors.js";
export { ApiError } from "./errors.js";
export function createClient(baseUrl = "", transport: typeof fetch = fetch) {
  return {
    async getInstance(signal?: AbortSignal) {
      const response = await transport(`${baseUrl}${routes.instance}`, {
        credentials: "same-origin",
        signal: signal ?? AbortSignal.timeout(8000),
        headers: { accept: "application/json" },
      });
      if (!response.ok)
        throw new ApiError("SERVICE_UNAVAILABLE", response.status);
      return publicInstanceSchema.parse(await response.json());
    },
    async getReadiness(signal?: AbortSignal): Promise<Readiness> {
      const response = await transport(`${baseUrl}${routes.ready}`, {
        credentials: "same-origin",
        signal: signal ?? AbortSignal.timeout(8000),
        headers: { accept: "application/json" },
      });
      const body: unknown = await response.json();
      if (response.status === 200 || response.status === 503) {
        const data = readinessSchema.parse(body);
        if ((response.status === 200) !== (data.status === "ready"))
          throw new ApiError("INVALID_RESPONSE", response.status);
        return data;
      }
      const error = errorSchema.safeParse(body);
      throw new ApiError(
        error.success ? error.data.error.code : "INVALID_RESPONSE",
        response.status,
        error.success ? error.data.error.requestId : undefined,
      );
    },
  };
}
export { createAuthClient } from "./auth.js";

export { createInvitationClient } from "./invitations.js";
export { createRegistrationClient } from './registration.js';
export { createFilesClient } from "./files.js";

export { createSubmissionClient } from "./submissions.js";

export {createFinanceClient} from "./finance.js";
export { createReceiptsClient } from "./documents.js";
export { createReviewClient } from "./reviews.js";
export { createProgramClient } from "./program.js";

export {createActivitiesClient} from './activities.js';

export { createOnsiteClient } from "./onsite.js";

export {createDocumentJobsClient} from "./document-jobs.js";
export { createReportingClient } from './reporting.js';
export { createCompetitionClient } from "./competitions.js";
export { createNotificationBatchClient } from './notification-batches.js';
export { createExportJobsClient } from './export-jobs.js';
export { createBadgeTemplateClient } from "./badge-template.js";

export * from "./presenter-changes.js";
export { createFinanceClient } from "./finance.js";

export { createFinanceReminderClient } from './finance-reminders.js';

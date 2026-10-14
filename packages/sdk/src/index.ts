import {
  readinessSchema,
  errorSchema,
  routes,
  type Readiness,
} from "@confsys/contracts";
import { ApiError } from "./errors.js";
export { ApiError } from "./errors.js";
export function createClient(baseUrl = "", transport: typeof fetch = fetch) {
  return {
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

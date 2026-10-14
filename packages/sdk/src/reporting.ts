import {
  reportingEndpoints,
  csrfSchema,
  errorSchema,
} from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createReportingClient(
  baseUrl = "",
  transport: typeof fetch = fetch,
) {
  async function response(path: string, signal: AbortSignal, input?: unknown) {
    let init: RequestInit = {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    };
    if (input !== undefined) {
      const csrf = csrfSchema.parse(
        await (await response("/api/auth/csrf", signal)).json(),
      );
      init = {
        ...init,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrf.csrfToken,
        },
        body: JSON.stringify(input),
      };
    }
    const result = await transport(baseUrl + path, init);
    if (!result.ok) {
      const error = errorSchema.safeParse(await result.json());
      throw new ApiError(
        error.success ? error.data.error.code : "INVALID_RESPONSE",
        result.status,
        error.success ? error.data.error.requestId : undefined,
      );
    }
    return result;
  }
  async function call<Output>(
    spec: {
      method: string;
      path: string;
      input: { parse: (value: unknown) => unknown };
      output: { parse: (value: unknown) => Output };
    },
    input: unknown,
    signal: AbortSignal,
  ): Promise<Output> {
    const data = spec.input.parse(input);
    const path =
      spec.method === "get"
        ? `${spec.path}?${new URLSearchParams(Object.entries(typeof data === "object" && data !== null ? data : {}).map(([k, v]) => [k, String(v)]))}`
        : spec.path;
    return spec.output.parse(
      await (
        await response(path, signal, spec.method === "post" ? data : undefined)
      ).json(),
    );
  }
  return {
    notifications: (offset: number, signal: AbortSignal) =>
      call(reportingEndpoints.notificationList, { offset }, signal),
    read: (id: string, signal: AbortSignal) =>
      call(reportingEndpoints.notificationRead, { id }, signal),
    stats: (signal: AbortSignal) =>
      call(reportingEndpoints.reportingStats, {}, signal),
    export: (
      kind: "registrations" | "submissions" | "emails",
      offset: number,
      signal: AbortSignal,
    ) => call(reportingEndpoints.reportingExport, { kind, offset }, signal),
    preview: (userId: string, reason: string, signal: AbortSignal) =>
      call(reportingEndpoints.authorPreview, { userId, reason }, signal),
  };
}

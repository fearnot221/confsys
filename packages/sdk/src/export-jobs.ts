import {
  exportJobEndpoints,
  csrfSchema,
  errorSchema,
} from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createExportJobsClient(
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
    list: (offset: number, signal: AbortSignal) =>
      call(exportJobEndpoints.exportJobList, { offset }, signal),
    create: (
      kind: "registrations" | "submissions" | "emails",
      idempotencyKey: string,
      signal: AbortSignal,
    ) =>
      call(
        exportJobEndpoints.exportJobCreate,
        { kind, idempotencyKey },
        signal,
      ),
    async download(id: string, signal: AbortSignal) {
      return (
        await response(
          `/api/reporting/export-jobs/${encodeURIComponent(id)}/download`,
          signal,
        )
      ).blob();
    },
  };
}

import { reviewEndpoints, csrfSchema, errorSchema } from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createReviewClient(
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
    screen: (input: unknown, signal: AbortSignal) =>
      call(reviewEndpoints.reviewScreen, input, signal),
    remind: (input: unknown, signal: AbortSignal) =>
      call(reviewEndpoints.reviewRemind, input, signal),
    board: (offset: number, signal: AbortSignal) =>
      call(reviewEndpoints.reviewBoard, { offset }, signal),
    assigned: (offset: number, signal: AbortSignal) =>
      call(reviewEndpoints.reviewAssigned, { offset }, signal),
    results: (offset: number, signal: AbortSignal) =>
      call(reviewEndpoints.reviewAuthorResults, { offset }, signal),
    conflict: (input: unknown, signal: AbortSignal) =>
      call(reviewEndpoints.reviewConflict, input, signal),
    configure: (input: unknown, signal: AbortSignal) =>
      call(reviewEndpoints.reviewForm, input, signal),
    scope: (input: unknown, signal: AbortSignal) =>
      call(reviewEndpoints.reviewScope, input, signal),
    assign: (input: unknown, signal: AbortSignal) =>
      call(reviewEndpoints.reviewAssign, input, signal),
    action: (input: unknown, signal: AbortSignal) =>
      call(reviewEndpoints.reviewAction, input, signal),
    decide: (input: unknown, signal: AbortSignal) =>
      call(reviewEndpoints.reviewDecide, input, signal),
    publish: (id: string, signal: AbortSignal) =>
      call(reviewEndpoints.reviewPublish, { id }, signal),
    async download(assignmentId: string, fileId: string, signal: AbortSignal) {
      return (
        await response(
          `/api/reviews/assignments/${encodeURIComponent(assignmentId)}/files/${encodeURIComponent(fileId)}`,
          signal,
        )
      ).blob();
    },
  };
}

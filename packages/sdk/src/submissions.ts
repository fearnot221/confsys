import {
  csrfSchema,
  errorSchema,
  submissionEndpoints,
} from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createSubmissionClient(
  baseUrl = "",
  transport: typeof fetch = fetch,
) {
  async function request(path: string, init: RequestInit) {
    const response = await transport(`${baseUrl}${path}`, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      const parsed = errorSchema.safeParse(body);
      throw new ApiError(
        parsed.success ? parsed.data.error.code : "INVALID_RESPONSE",
        response.status,
        parsed.success ? parsed.data.error.requestId : undefined,
      );
    }
    return body;
  }
  return async <K extends keyof typeof submissionEndpoints>(
    operation: K,
    input: unknown,
    signal: AbortSignal,
  ) => {
    const spec = submissionEndpoints[operation];
    const parsed = "input" in spec ? spec.input.parse(input) : undefined;
    if (spec.method === "get") {
      const query = parsed
        ? `?${new URLSearchParams(Object.entries(parsed).map(([key, value]) => [key, String(value)]))}`
        : "";
      return spec.output.parse(await request(spec.path + query, { signal }));
    }
    const { csrfToken } = csrfSchema.parse(
      await request("/api/auth/csrf", { signal }),
    );
    return spec.output.parse(
      await request(spec.path, {
        method: "POST",
        signal,
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(parsed),
      }),
    );
  };
}

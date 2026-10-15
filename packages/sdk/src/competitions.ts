import {
  csrfSchema,
  errorSchema,
  competitionEndpoints,
} from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createCompetitionClient(
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
      const error = errorSchema.safeParse(body);
      throw new ApiError(
        error.success ? error.data.error.code : "INVALID_RESPONSE",
        response.status,
        error.success ? error.data.error.requestId : undefined,
      );
    }
    return body;
  }
  return async <K extends keyof typeof competitionEndpoints>(
    operation: K,
    input: unknown,
    signal: AbortSignal,
  ) => {
    const spec = competitionEndpoints[operation];
    if (spec.method === "get") {
      const data = "input" in spec ? spec.input.parse(input ?? {}) : {};
      const query = new URLSearchParams(
        Object.entries(data).map(([key, value]) => [key, String(value)]),
      );
      return spec.output.parse(
        await request(`${spec.path}${query.size ? `?${query}` : ""}`, {
          signal,
        }),
      );
    }
    const data = spec.input.parse(input),
      { csrfToken } = csrfSchema.parse(
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
        body: JSON.stringify(data),
      }),
    );
  };
}

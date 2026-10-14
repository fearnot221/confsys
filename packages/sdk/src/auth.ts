import {
  accountSchema,
  authOperations,
  csrfSchema,
  errorSchema,
  type AuthOperation,
  type AuthInput,
} from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createAuthClient(
  baseUrl = "",
  transport: typeof fetch = fetch,
) {
  async function request(path: string, init: RequestInit = {}) {
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
  return {
    async me(signal?: AbortSignal) {
      return accountSchema.parse(
        await request("/api/auth/me", {
          signal: signal ?? AbortSignal.timeout(8000),
        }),
      );
    },
    async mutate<K extends AuthOperation>(
      operation: K,
      input: AuthInput<K>,
      signal?: AbortSignal,
    ) {
      const spec = authOperations[operation];
      const data = spec.input.parse(input);
      const abort = signal ?? AbortSignal.timeout(15000);
      const { csrfToken } = csrfSchema.parse(
        await request("/api/auth/csrf", { signal: abort }),
      );
      return spec.output.parse(
        await request(spec.path, {
          method: "POST",
          signal: abort,
          headers: {
            "content-type": "application/json",
            "x-csrf-token": csrfToken,
          },
          body: JSON.stringify(data),
        }),
      );
    },
  };
}

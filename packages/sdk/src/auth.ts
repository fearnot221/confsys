import {
  siteEndpoints,
  siteSaveInput,
  siteVersionInput,
  siteRestoreInput,
  accountSchema,
  directorySchema,
  directoryAccountSchema,
  directoryQuery,
  roleCatalogSchema,
  auditPageSchema,
  accessMutationInput,
  accessResultSchema,
  type AccessMutation,
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
  async function siteRequest<K extends keyof typeof siteEndpoints>(
    operation: K,
    input: unknown,
    signal: AbortSignal,
  ) {
    const spec = siteEndpoints[operation];
    if (spec.method === "get") {
      const query =
        operation === "siteHistory"
          ? `?offset=${Number(input)}`
          : operation === "sitePreview"
            ? `?version=${Number(input)}`
            : "";
      return spec.output.parse(await request(spec.path + query, { signal }));
    }
    const data = (
      operation === "siteSave"
        ? siteSaveInput
        : operation === "siteRestore"
          ? siteRestoreInput
          : siteVersionInput
    ).parse(input);
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
        body: JSON.stringify(data),
      }),
    );
  }
  return {
    site: siteRequest,
    async directory(
      input: {
        search?: string;
        state?: "pending" | "active" | "disabled";
        offset?: number;
      },
      signal: AbortSignal,
    ) {
      const query = directoryQuery.parse(input);
      const params = new URLSearchParams(
        Object.entries(query).map(([key, value]) => [key, String(value)]),
      );
      return directorySchema.parse(
        await request(`/api/access/accounts?${params}`, { signal }),
      );
    },
    async detail(id: string, signal: AbortSignal) {
      return directoryAccountSchema.parse(
        await request(`/api/access/accounts/${encodeURIComponent(id)}`, {
          signal,
        }),
      );
    },
    async roles(signal: AbortSignal) {
      return roleCatalogSchema.parse(
        await request("/api/access/roles", { signal }),
      );
    },
    async audit(offset: number, signal: AbortSignal) {
      return auditPageSchema.parse(
        await request(`/api/access/audit?offset=${offset}`, { signal }),
      );
    },
    async manage(id: string, input: AccessMutation, signal: AbortSignal) {
      const data = accessMutationInput.parse(input);
      const { csrfToken } = csrfSchema.parse(
        await request("/api/auth/csrf", { signal }),
      );
      return accessResultSchema.parse(
        await request(
          `/api/access/accounts/${encodeURIComponent(id)}/actions`,
          {
            method: "POST",
            signal,
            headers: {
              "content-type": "application/json",
              "x-csrf-token": csrfToken,
            },
            body: JSON.stringify(data),
          },
        ),
      );
    },
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

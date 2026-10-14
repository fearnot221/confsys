import {
  csrfSchema,
  errorSchema,
  documentJobEndpoints,
} from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createDocumentJobsClient(
  baseUrl = "",
  transport: typeof fetch = fetch,
) {
  async function request(path: string, init: RequestInit) {
    const response = await transport(baseUrl + path, {
      credentials: "same-origin",
      cache: "no-store",
      ...init,
    });
    if (!response.ok) {
      const parsed = errorSchema.safeParse(await response.json());
      throw new ApiError(
        parsed.success ? parsed.data.error.code : "INVALID_RESPONSE",
        response.status,
        parsed.success ? parsed.data.error.requestId : undefined,
      );
    }
    return response;
  }
  return {
    async operation(
      operation: keyof typeof documentJobEndpoints,
      input: unknown,
      signal: AbortSignal,
    ) {
      const spec = documentJobEndpoints[operation],
        data = spec.input.parse(input);
      if (spec.method === "get")
        return spec.output.parse(
          await (
            await request(
              `${spec.path}?offset=${"offset" in data ? data.offset : 0}`,
              { signal },
            )
          ).json(),
        );
      const { csrfToken } = csrfSchema.parse(
        await (await request("/api/auth/csrf", { signal })).json(),
      );
      return spec.output.parse(
        await (
          await request(spec.path, {
            signal,
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-csrf-token": csrfToken,
            },
            body: JSON.stringify(data),
          })
        ).json(),
      );
    },
    async download(id: string, signal: AbortSignal) {
      return (
        await request(`/api/document-jobs/${encodeURIComponent(id)}/pdf`, {
          signal,
        })
      ).blob();
    },
  };
}

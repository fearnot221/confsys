import {
  badgeTemplate,
  badgeTemplateSave,
  csrfSchema,
  errorSchema,
} from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createBadgeTemplateClient(
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
    async get(signal: AbortSignal) {
      return badgeTemplate.parse(
        await (await request("/api/badge-template", { signal })).json(),
      );
    },
    async save(input: unknown, signal: AbortSignal) {
      const data = badgeTemplateSave.parse(input),
        { csrfToken } = csrfSchema.parse(
          await (await request("/api/auth/csrf", { signal })).json(),
        );
      return badgeTemplate.parse(
        await (
          await request("/api/badge-template", {
            method: "POST",
            signal,
            headers: {
              "content-type": "application/json",
              "x-csrf-token": csrfToken,
            },
            body: JSON.stringify(data),
          })
        ).json(),
      );
    },
    async preview(signal: AbortSignal) {
      return (await request("/api/badge-template/preview", { signal })).blob();
    },
  };
}

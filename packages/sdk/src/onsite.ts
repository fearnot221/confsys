import { csrfSchema, errorSchema, onsiteEndpoints } from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createOnsiteClient(
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
      const error = errorSchema.safeParse(await response.json());
      throw new ApiError(
        error.success ? error.data.error.code : "INVALID_RESPONSE",
        response.status,
        error.success ? error.data.error.requestId : undefined,
      );
    }
    return response;
  }
  return {
    async operation(
      operation: keyof typeof onsiteEndpoints,
      input: unknown,
      signal: AbortSignal,
    ) {
      const spec = onsiteEndpoints[operation],
        data = spec.input.parse(input);
      if (spec.method === "get") {
        const query = new URLSearchParams();
        if ("search" in data) query.set("search", data.search);
        if ("offset" in data) query.set("offset", String(data.offset));
        return spec.output.parse(
          await (await request(`${spec.path}?${query}`, { signal })).json(),
        );
      }
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
  };
}

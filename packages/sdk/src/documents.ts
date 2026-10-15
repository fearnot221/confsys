import {
  csrfSchema,
  errorSchema,
  receiptEndpoints,
  receiptHistorySchema,
  type Receipt,
} from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createReceiptsClient(
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
      operation: keyof typeof receiptEndpoints,
      input: unknown,
      signal: AbortSignal,
    ) {
      const spec = receiptEndpoints[operation],
        data = spec.input.parse(input);
      if (spec.method === "get")
        return spec.output.parse(
          await (
            await request(
              `${spec.path}?${"id" in data ? `id=${encodeURIComponent(data.id)}` : `offset=${"offset" in data ? data.offset : 0}`}`,
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
    async history(id: string, signal: AbortSignal) {
      return receiptHistorySchema.parse(
        await (
          await request(`/api/receipts/${encodeURIComponent(id)}/history`, {
            signal,
          })
        ).json(),
      );
    },
    async download(receipt: Receipt, revision: number, signal: AbortSignal) {
      return (
        await request(
          `/api/receipts/${encodeURIComponent(receipt.id)}/pdf?revision=${revision}`,
          { signal },
        )
      ).blob();
    },
  };
}

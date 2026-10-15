import {
  csrfSchema,
  errorSchema,
  invitationEndpoints,
  invitationCreateInput,
  invitationRevokeInput,
  invitationAcceptInput,
  type Role,
} from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createInvitationClient(
  baseUrl = "",
  transport: typeof fetch = fetch,
) {
  async function request(path: string, signal: AbortSignal, input?: unknown) {
    let init: RequestInit = {
      credentials: "same-origin",
      cache: "no-store",
      signal,
    };
    if (input !== undefined) {
      const { csrfToken } = csrfSchema.parse(
        await request("/api/auth/csrf", signal),
      );
      init = {
        ...init,
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-csrf-token": csrfToken,
        },
        body: JSON.stringify(input),
      };
    }
    const response = await transport(baseUrl + path, init);
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
    async list(offset: number, signal: AbortSignal) {
      const spec = invitationEndpoints.list;
      return spec.output.parse(
        await request(`${spec.path}?offset=${offset}`, signal),
      );
    },
    async create(
      input: {
        email: string;
        role: Role;
        reason: string;
        idempotencyKey: string;
      },
      signal: AbortSignal,
    ) {
      const spec = invitationEndpoints.create;
      return spec.output.parse(
        await request(spec.path, signal, invitationCreateInput.parse(input)),
      );
    },
    async revoke(id: string, reason: string, signal: AbortSignal) {
      const spec = invitationEndpoints.revoke;
      return spec.output.parse(
        await request(
          spec.path.replace(":id", encodeURIComponent(id)),
          signal,
          invitationRevokeInput.parse({ reason }),
        ),
      );
    },
    async accept(token: string, signal: AbortSignal) {
      const spec = invitationEndpoints.accept;
      return spec.output.parse(
        await request(
          spec.path,
          signal,
          invitationAcceptInput.parse({ token }),
        ),
      );
    },
  };
}

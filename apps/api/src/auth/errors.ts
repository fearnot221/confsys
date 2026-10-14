import type { ErrorCode } from "@confsys/contracts";
export class AuthError extends Error {
  constructor(public readonly code: ErrorCode) {
    super(code);
  }
}

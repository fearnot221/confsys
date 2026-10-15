import { AuthError } from "../auth/errors.js";

export function translateActivityConflict(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    "constraint" in error &&
    ((error.code === "23505" && error.constraint === "bookings_active") ||
      (error.code === "23514" &&
        error.constraint === "booking_redemption_guard"))
  ) {
    throw new AuthError("CONFLICT");
  }
  throw error;
}

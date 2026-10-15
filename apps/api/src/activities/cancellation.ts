import type { PoolClient } from "pg";
import { AuthError } from "../auth/errors.js";
// Both cancellation entry points hold registration_state first. Use the same
// current activity deadline and database clock, including registration cascades.
export async function assertActivityCancellationAllowed(
  db: PoolClient,
  input: { registrationId: string } | { bookingId: string },
  administrative: boolean,
) {
  if (administrative) return;
  const closed = await db.query(
    `SELECT b.id FROM confsys.activity_bookings b
    JOIN confsys.activities a ON a.id=b.activity_id
    JOIN confsys.activity_versions v ON v.id=a.id AND v.version=a.version
    WHERE b.state='reserved' AND ($1::uuid IS NULL OR b.registration_id=$1)
      AND ($2::uuid IS NULL OR b.id=$2)
      AND (v.document->>'deadline')::timestamptz<=clock_timestamp() LIMIT 1`,
    [
      "registrationId" in input ? input.registrationId : null,
      "bookingId" in input ? input.bookingId : null,
    ],
  );
  if (closed.rowCount) throw new AuthError("CONFLICT");
}

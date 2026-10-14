import type { Pool } from "pg";
import { withIdentityTransaction } from "@confsys/db";
import { bootstrapInput } from "@confsys/contracts";
import { AuthError } from "../auth/errors.js";
import {
  lockUser,
  revokeSessions,
  advanceCredentialVersion,
} from "../auth/repository.js";
import {
  lockAccess,
  accountById,
  recordAccess,
  grantRole,
  completeBootstrap,
  requireOperatorConnection,
} from "./repository.js";
// Operator-only entry point. Not imported by HTTP/worker. Use the selected instance's migrator login.
export async function bootstrapAdministrator(
  pool: Pool,
  instance: { conferenceName: string; origin: string },
  input: unknown,
  requestId: string,
) {
  const args = bootstrapInput.parse(input);
  if (args.apply && (!args.reason || args.confirmOrigin !== instance.origin))
    throw new AuthError("INVALID_REQUEST");
  return withIdentityTransaction(pool, async (db) => {
    await requireOperatorConnection(db);
    const control = await lockAccess(db);
    const target = await lockUser(db, args.targetId);
    const account = await accountById(db, args.targetId);
    if (
      !target ||
      target.state !== "active" ||
      !target.password_hash ||
      !account.verified
    )
      throw new AuthError("CONFLICT");
    if (
      control.initialized_user_id &&
      control.initialized_user_id !== args.targetId
    )
      throw new AuthError("BOOTSTRAP_COMPLETED");
    const result = {
      instance,
      target: account,
      completed: !!control.initialized_user_id,
      changed: false,
    };
    if (!args.apply || control.initialized_user_id) return result;
    await grantRole(db, args.targetId, "conference_admin");
    await completeBootstrap(db, args.targetId);
    await advanceCredentialVersion(db, args.targetId);
    await revokeSessions(db, args.targetId, new Date());
    await recordAccess(db, {
      action: "access.bootstrap",
      targetId: args.targetId,
      actorId: null,
      source: "operator_cli",
      reason: args.reason!,
      before: "uninitialized",
      after: "conference_admin",
      requestId,
    });
    return { ...result, completed: true, changed: true };
  });
}

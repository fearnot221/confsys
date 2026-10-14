import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { AuthError } from "./errors.js";
import { lockUser, touchValidSession, sessionByHash } from "./repository.js";
export const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
// A raw server-session credential is revalidated here, never a caller-supplied actor DTO.
export async function sessionActor(
  db: PoolClient,
  raw: string | undefined,
  config: Pick<ApiConfig, "SESSION_IDLE_SECONDS">,
  now: Date,
  lock = false,
) {
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw))
    throw new AuthError("SESSION_EXPIRED");
  const hash = tokenHash(raw);
  if (lock) {
    const initial = await sessionByHash(db, hash);
    if (!initial || !(await lockUser(db, initial.user_id)))
      throw new AuthError("SESSION_EXPIRED");
  }
  const user = await touchValidSession(
    db,
    hash,
    now,
    new Date(now.getTime() - config.SESSION_IDLE_SECONDS * 1000),
  );
  if (!user) throw new AuthError("SESSION_EXPIRED");
  const proof = await sessionByHash(db, hash);
  return {
    ...user,
    hash,
    passwordVerifiedAt: proof?.password_verified_at ?? null,
  };
}

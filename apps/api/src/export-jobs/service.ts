import { randomUUID, createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { exportJobInput, exportJobEndpoints } from "@confsys/contracts";
import {
  lockAccessShared,
  rolesFor,
  recordAccess,
} from "../access/repository.js";
import { requirePermission, assertRecentPassword } from "../access/policy.js";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import * as repo from "./repository.js";
export function createExportJobsService(pool: Pool, config: ApiConfig) {
  async function transaction<T>(
    raw: string | undefined,
    fresh: boolean,
    work: (db: PoolClient, actor: string) => Promise<T>,
  ) {
    return withIdentityTransaction(pool, async (db) => {
      await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      requirePermission(await rolesFor(db, actor.id), "reporting.export");
      if (fresh) assertRecentPassword(actor.passwordVerifiedAt, new Date());
      await repo.context(db, actor.id);
      return work(db, actor.id);
    });
  }
  async function audit(
    db: PoolClient,
    actor: string,
    id: string,
    event: string,
    requestId: string,
  ) {
    await recordAccess(db, {
      actorId: actor,
      targetId: actor,
      action: event,
      source: "session",
      reason: "Explicit private CSV export action",
      before: "null",
      after: JSON.stringify({ jobId: id }),
      requestId,
    });
  }
  return {
    list: (raw: string | undefined, input: unknown) =>
      transaction(raw, false, (db) =>
        repo.list(
          db,
          exportJobEndpoints.exportJobList.input.parse(input).offset,
        ),
      ),
    create: (raw: string | undefined, input: unknown, requestId: string) =>
      transaction(raw, true, async (db, actor) => {
        const data = exportJobInput.parse(input),
          hash = createHash("sha256").update(data.kind).digest("hex"),
          old = await repo.prior(db, actor, data.idempotencyKey);
        if (old) {
          if (old.request_hash !== hash) throw new AuthError("CONFLICT");
          return repo.detail(db, old.id);
        }
        if ((await repo.pending(db)) >= 5) throw new AuthError("CONFLICT");
        const id = randomUUID(),
          job = await repo.insert(
            db,
            id,
            actor,
            data.kind,
            data.idempotencyKey,
            hash,
          );
        await audit(db, actor, id, "export.requested", requestId);
        return job;
      }),
    download: (raw: string | undefined, id: string, requestId: string) =>
      transaction(raw, true, async (db, actor) => {
        const row = await repo.content(db, id);
        if (!row) throw new AuthError("NOT_FOUND");
        if (!row.valid || !row.csv || !row.sha256)
          throw new AuthError("CONFLICT");
        if (createHash("sha256").update(row.csv).digest("hex") !== row.sha256)
          throw new AuthError("CONFLICT");
        await audit(db, actor, id, "export.downloaded", requestId);
        return { bytes: row.csv, name: `export-${row.kind}-${id}.csv` };
      }),
  };
}

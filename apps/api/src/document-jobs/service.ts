import { randomUUID, createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { documentJobCreateInput, badgeJobSnapshot } from "@confsys/contracts";
import { passHash, passToken } from "@confsys/documents";
import { lockAccessShared, rolesFor } from "../access/repository.js";
import { requirePermission } from "../access/policy.js";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import { effectivePublicSite } from "../site/branding.js";
import * as onsite from "../onsite/repository.js";
import * as repo from "./repository.js";
import { current as currentBadgeTemplate } from "../badge-template/repository.js";
export function createDocumentJobsService(pool: Pool, config: ApiConfig) {
  const authorized = <T>(
    raw: string | undefined,
    work: (db: PoolClient, actor: string) => Promise<T>,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      requirePermission(await rolesFor(db, actor.id), "onsite.read");
      await db.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.onsite_admin','true',true)",
        [actor.id],
      );
      return work(db, actor.id);
    });
  return {
    list(raw: string | undefined, offset: number) {
      return authorized(raw, (db) => repo.list(db, offset));
    },
    create(raw: string | undefined, input: unknown, requestId: string) {
      const data = documentJobCreateInput.parse(input);
      return authorized(raw, async (db, actor) => {
        await db.query(
          "SELECT singleton FROM confsys.registration_state FOR UPDATE",
        );
        const ids = [...data.registrationIds].sort(),
          hash = passHash(JSON.stringify(ids)),
          previous = await repo.byKey(db, actor, data.idempotencyKey);
        if (previous) {
          if (previous.row.request_hash !== hash)
            throw new AuthError("CONFLICT");
          return previous.document;
        }
        if ((await repo.pending(db)) >= 5) throw new AuthError("CONFLICT");
        const brand = await effectivePublicSite(db, config.CONFERENCE_NAME),
          badges = [];
        for (const id of ids) {
          const r = await onsite.registration(db, id);
          if (r.state !== "confirmed") throw new AuthError("CONFLICT");
          let token = await onsite.tokenForRegistration(db, id);
          if (
            !token ||
            token.token_hash !==
              passHash(passToken(token.token_id, config.QR_SIGNING_KEY))
          ) {
            const tokenId = randomUUID(),
              hash = passHash(passToken(tokenId, config.QR_SIGNING_KEY));
            await onsite.saveToken(db, id, tokenId, hash);
            token = {
              registration_id: id,
              token_id: tokenId,
              token_hash: hash,
            };
          }
          badges.push({
            registrationId: id,
            tokenId: token.token_id,
            tokenHash: token.token_hash,
            name: r.badge_name,
            affiliation: r.affiliation,
            registrationNumber: r.number,
          });
        }
        const snapshot = badgeJobSnapshot.parse({
            conferenceName: brand.conferenceName,
            template: await currentBadgeTemplate(db),
            badges,
          }),
          id = randomUUID(),
          result = await repo.insert(
            db,
            id,
            actor,
            data.idempotencyKey,
            hash,
            snapshot,
          );
        await onsite.audit(
          db,
          actor,
          id,
          "document.badges.requested",
          `Requested ${badges.length} badges`,
          requestId,
        );
        return result;
      });
    },
    download(raw: string | undefined, id: string, requestId: string) {
      return authorized(raw, async (db, actor) => {
        await db.query(
          "SELECT singleton FROM confsys.registration_state FOR UPDATE",
        );
        const { row } = await repo.byId(db, id);
        const eligibility = (
          await db.query<{ requester_active: boolean }>(
            "SELECT requester_active FROM confsys.document_job_eligibility WHERE id=$1",
            [id],
          )
        ).rows[0];
        if (!eligibility?.requester_active) throw new AuthError("CONFLICT");
        if (row.status !== "ready" || !row.pdf || !row.sha256)
          throw new AuthError("CONFLICT");
        for (const badge of badgeJobSnapshot.parse(row.snapshot).badges) {
          const r = await onsite.registration(db, badge.registrationId),
            token = await onsite.tokenForRegistration(db, badge.registrationId);
          if (
            r.state !== "confirmed" ||
            token?.token_id !== badge.tokenId ||
            token.token_hash !== badge.tokenHash ||
            passHash(passToken(badge.tokenId, config.QR_SIGNING_KEY)) !==
              badge.tokenHash
          )
            throw new AuthError("CONFLICT");
        }
        if (createHash("sha256").update(row.pdf).digest("hex") !== row.sha256)
          throw new AuthError("CONFLICT");
        await onsite.audit(
          db,
          actor,
          id,
          "document.badges.downloaded",
          "Downloaded batch PDF",
          requestId,
        );
        return { bytes: row.pdf, name: `badges-${id}.pdf` };
      });
    },
  };
}

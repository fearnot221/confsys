import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import {
  siteSaveInput,
  siteVersionInput,
  siteRestoreInput,
  siteIssues,
  siteChangedFields,
  type Permission,
} from "@confsys/contracts";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import { lockAccess, rolesFor } from "../access/repository.js";
import { requirePermission, assertRecentPassword, permissionsFor } from "../access/policy.js";
import * as repo from "./repository.js";
import { validateMediaReferences, referenceMedia, fileContext } from "../files/repository.js";
import type { SiteDocument } from "@confsys/contracts";
const mediaIds = (document: SiteDocument) => [...new Set([document.media?.logoId, document.media?.heroId].filter((id): id is string => !!id))];
async function validateMediaChange(db: PoolClient, actor: string, before: SiteDocument, after: SiteDocument) {
  if (JSON.stringify(before.media) !== JSON.stringify(after.media)) {
    requirePermission(await rolesFor(db, actor), "files.media.manage");
    await validateMediaReferences(db, mediaIds(after));
  }
}
import { effectivePublicSite } from "./branding.js";
export function createSiteService(pool: Pool, config: ApiConfig) {
  const authorized = <T>(
    raw: string | undefined,
    permission: Permission,
    work: (db: PoolClient, actorId: string) => Promise<T>,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      // Shared lock order with access: control -> actor user -> site. Revalidate AFTER waiting.
      // Private reads take the same fence so late authority changes cannot reveal a draft.
      await lockAccess(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      const roles=await rolesFor(db,actor.id);
      requirePermission(roles, permission);
      await fileContext(db,actor.id,permissionsFor(roles).includes("files.media.manage"));
      if (permission === "site.publish")
        assertRecentPassword(actor.passwordVerifiedAt, new Date());
      return work(db, actor.id);
    });
  const current = (db: PoolClient) => repo.draft(db, config.CONFERENCE_NAME);
  const version = (actual: number, expected: number) => {
    if (actual !== expected) throw new AuthError("CONFLICT");
  };
  return {
    public: () => effectivePublicSite(pool, config.CONFERENCE_NAME),
    draft: (raw: string | undefined) =>
      authorized(raw, "site.draft.read", current),
    preview: (raw: string | undefined, expected: number) =>
      authorized(raw, "site.draft.read", async (db) => {
        const d = await current(db);
        version(d.draftVersion, expected);
        if (!expected) throw new AuthError("NOT_FOUND");
        return d;
      }),
    history: (raw: string | undefined, offset: number) =>
      authorized(raw, "site.draft.read", (db) => repo.history(db, offset)),
    save: async (raw: string | undefined, input: unknown, requestId: string) => {
      const data = siteSaveInput.parse(input);
      if (siteIssues(data.document, false).length)
        throw new AuthError("INVALID_REQUEST");
      return authorized(raw, "site.draft.write", async (db, actor) => {
        const before = await current(db);
        version(before.draftVersion, data.expectedVersion);
        await validateMediaChange(db, actor, before.document, data.document);
        await repo.save(db, data.document, data.expectedVersion);
        await repo.recordSite(
          db,
          actor,
          requestId,
          "site.draft_saved",
          data.expectedVersion + 1,
          siteChangedFields(before.document, data.document),
        );
        return current(db);
      });
    },
    publish: async (raw: string | undefined, input: unknown, requestId: string) => {
      const data = siteVersionInput.parse(input);
      return authorized(raw, "site.publish", async (db, actor) => {
        const d = await current(db);
        version(d.draftVersion, data.expectedVersion);
        if (!d.draftVersion || siteIssues(d.document, true).length)
          throw new AuthError("INVALID_REQUEST");
        const existing = await repo.publicationForVersion(db, d.draftVersion);
        if (existing) return existing;
        const previous = await repo.published(db),
          fields = siteChangedFields(previous?.document ?? null, d.document);
        await validateMediaReferences(db, mediaIds(d.document));
        const publication = await repo.insertPublication(
          db,
          d.document,
          d.draftVersion,
          actor,
          fields,
        );
        await referenceMedia(db, mediaIds(d.document), publication.publicationId);
        await repo.recordSite(
          db,
          actor,
          requestId,
          "site.published",
          d.draftVersion,
          fields,
          publication.publicationId,
        );
        return publication;
      });
    },
    restore: async (raw: string | undefined, input: unknown, requestId: string) => {
      const data = siteRestoreInput.parse(input);
      return authorized(raw, "site.draft.write", async (db, actor) => {
        const d = await current(db);
        version(d.draftVersion, data.expectedVersion);
        const document = await repo.historicalDocument(db, data.publicationId);
        await validateMediaChange(db, actor, d.document, document);
        await repo.save(db, document, d.draftVersion);
        await repo.recordSite(
          db,
          actor,
          requestId,
          "site.history_loaded",
          d.draftVersion + 1,
          siteChangedFields(d.document, document),
          data.publicationId,
        );
        return current(db);
      });
    },
  };
}

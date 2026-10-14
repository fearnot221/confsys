import type { Pool, PoolClient } from "pg";
import type { ApiConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import {
  programEndpoints,
  type ProgramDraft,
  type PublicProgram,
} from "@confsys/contracts";
import { enqueueBusinessNotification } from "@confsys/notifications";
import {
  lockAccess,
  lockAccessShared,
  rolesFor,
} from "../access/repository.js";
import { requirePermission, assertRecentPassword } from "../access/policy.js";
import { sessionActor } from "../auth/session.js";
import { AuthError } from "../auth/errors.js";
import { effectivePublicSite } from "../site/branding.js";
import * as repo from "./repository.js";
import { publishedAcceptedRevision } from "../submissions/repository.js";
import {
  assertInterval,
  assertVersion,
  assertIdKind,
  contains,
} from "./policy.js";
function translate(error: unknown): never {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    ["23505", "23503", "23P01"].includes(String(error.code))
  )
    throw new AuthError("CONFLICT");
  throw error;
}
export function createProgramService(pool: Pool, config: ApiConfig) {
  const authorized = <T>(
    raw: string | undefined,
    publish: boolean,
    work: (db: PoolClient, actor: string) => Promise<T>,
    mutation = true,
  ) =>
    withIdentityTransaction(pool, async (db) => {
      // Schedule writes fence author withdrawals and review publications before reading eligibility.
      // Draft reads only need the shared revocation fence. No external I/O occurs under this lock.
      if (mutation) await lockAccess(db);
      else await lockAccessShared(db);
      const actor = await sessionActor(db, raw, config, new Date(), true);
      requirePermission(
        await rolesFor(db, actor.id),
        publish ? "program.publish" : "program.manage",
      );
      if (publish) assertRecentPassword(actor.passwordVerifiedAt, new Date());
      await db.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.submissions_admin','true',true),set_config('app.program_publish',$2,true),set_config('app.program_manage','true',true)",
        [actor.id, String(publish)],
      );
      return work(db, actor.id);
    }).catch(translate);
  const mutate = (
    raw: string | undefined,
    version: number,
    event: string,
    id: string,
    requestId: string,
    work: (db: PoolClient, draft: ProgramDraft) => Promise<void>,
  ) =>
    authorized(raw, false, async (db, actor) => {
      assertVersion((await repo.state(db, true)).version, version);
      const d = await repo.draft(db);
      await work(db, d);
      await repo.changed(db, actor, event, id, requestId);
      return repo.draft(db);
    });
  const accepted = async (db: PoolClient, id: string) => {
    const r = await publishedAcceptedRevision(db, id),
      d = r.document,
      presenter = d.authors[d.presenterIndex];
    if (!presenter) throw new AuthError("CONFLICT");
    return {
      revisionId: id,
      submissionId: r.submissionId,
      ownerId: r.ownerId,
      title: d.title,
      presenterName: presenter.name,
      presenterAffiliation: presenter.affiliation,
      presenterKey: presenter.email.toLowerCase(),
      kind: r.presentation,
    };
  };
  return {
    public: () => repo.publicProgram(pool),
    mine: (raw: string | undefined) =>
      withIdentityTransaction(pool, async (db) => {
        await lockAccessShared(db);
        const actor = await sessionActor(db, raw, config, new Date(), true);
        await db.query("SELECT set_config('app.actor_id',$1,true)", [actor.id]);
        return repo.personalProgram(db, actor.id);
      }),
    draft: (raw: string | undefined) =>
      authorized(raw, false, (db) => repo.draft(db), false),
    room: (raw: string | undefined, input: unknown, requestId: string) => {
      const { expectedVersion, item } =
        programEndpoints.programRoom.input.parse(input);
      return mutate(
        raw,
        expectedVersion,
        "program.room_saved",
        item.id,
        requestId,
        async (db, d) => {
          assertIdKind(d, item.id, "room");
          await repo.saveRoom(db, item);
          for (const session of d.sessions.filter((s) => s.roomId === item.id))
            await repo.bookRoom(
              db,
              session.id,
              item.id,
              "session",
              session.startsAt,
              session.endsAt,
              item.bufferMinutes,
            );
        },
      );
    },
    blocked: (raw: string | undefined, input: unknown, requestId: string) => {
      const { expectedVersion, item } =
        programEndpoints.programBlocked.input.parse(input);
      assertInterval(item.startsAt, item.endsAt);
      return mutate(
        raw,
        expectedVersion,
        "program.blocked_saved",
        item.id,
        requestId,
        async (db, d) => {
          assertIdKind(d, item.id, "blocked");
          if (!d.rooms.some((r) => r.id === item.roomId))
            throw new AuthError("NOT_FOUND");
          await repo.saveBlocked(db, item);
        },
      );
    },
    session: (raw: string | undefined, input: unknown, requestId: string) => {
      const { expectedVersion, item } =
        programEndpoints.programSession.input.parse(input);
      assertInterval(item.startsAt, item.endsAt);
      return mutate(
        raw,
        expectedVersion,
        "program.session_saved",
        item.id,
        requestId,
        async (db, d) => {
          assertIdKind(d, item.id, "session");
          const room = d.rooms.find((r) => r.id === item.roomId);
          if (!room) throw new AuthError("NOT_FOUND");
          if (
            d.slots.some((s) => s.sessionId === item.id && !contains(item, s))
          )
            throw new AuthError("CONFLICT");
          await repo.saveSession(db, item, room.bufferMinutes);
        },
      );
    },
    slot: (raw: string | undefined, input: unknown, requestId: string) => {
      const { expectedVersion, item } =
        programEndpoints.programSlot.input.parse(input);
      assertInterval(item.startsAt, item.endsAt);
      return mutate(
        raw,
        expectedVersion,
        "program.slot_saved",
        item.id,
        requestId,
        async (db, d) => {
          assertIdKind(d, item.id, "slot");
          const session = d.sessions.find((s) => s.id === item.sessionId);
          if (!session) throw new AuthError("NOT_FOUND");
          if (
            !contains(session, item) ||
            (item.kind === "poster") !== (item.posterNumber !== null)
          )
            throw new AuthError("INVALID_REQUEST");
          if (item.kind === "invited") {
            if (
              item.revisionId ||
              !item.invitedTitle ||
              !item.invitedSpeaker ||
              !item.invitedEmail
            )
              throw new AuthError("INVALID_REQUEST");
            await repo.saveSlot(db, {
              id: item.id,
              sessionId: item.sessionId,
              kind: "invited",
              revisionId: null,
              submissionId: null,
              ownerId: null,
              title: item.invitedTitle,
              presenterName: item.invitedSpeaker,
              presenterAffiliation: item.invitedAffiliation,
              presenterKey: item.invitedEmail.toLowerCase(),
              startsAt: item.startsAt,
              endsAt: item.endsAt,
              posterNumber: null,
            });
          } else {
            if (!item.revisionId) throw new AuthError("INVALID_REQUEST");
            const revision = await accepted(db, item.revisionId);
            if (revision.kind !== item.kind) throw new AuthError("CONFLICT");
            await repo.saveSlot(db, {
              ...revision,
              id: item.id,
              sessionId: item.sessionId,
              startsAt: item.startsAt,
              endsAt: item.endsAt,
              posterNumber: item.posterNumber,
            });
          }
        },
      );
    },
    remove: (raw: string | undefined, input: unknown, requestId: string) => {
      const data = programEndpoints.programRemove.input.parse(input);
      return mutate(
        raw,
        data.expectedVersion,
        "program.removed",
        data.id,
        requestId,
        async (db, d) => {
          const list =
            data.kind === "room"
              ? d.rooms
              : data.kind === "blocked"
                ? d.blocked
                : data.kind === "session"
                  ? d.sessions
                  : d.slots;
          if (!list.some((v) => v.id === data.id))
            throw new AuthError("NOT_FOUND");
          await repo.remove(db, data.kind, data.id);
        },
      );
    },
    publish: (raw: string | undefined, input: unknown, requestId: string) => {
      const data = programEndpoints.programPublish.input.parse(input);
      return authorized(raw, true, async (db, actor) => {
        assertVersion(
          (await repo.state(db, true)).version,
          data.expectedVersion,
        );
        if (await repo.publishedFor(db, data.expectedVersion))
          return repo.publicProgram(db);
        const d = await repo.draft(db),
          recipients = new Set<string>();
        for (const slot of d.slots)
          if (slot.revisionId) {
            const revision = await accepted(db, slot.revisionId);
            if (revision.kind !== slot.kind) throw new AuthError("CONFLICT");
            recipients.add(revision.ownerId);
          }
        const sessions: PublicProgram["sessions"] = d.sessions.map((s) => {
          const room = d.rooms.find((r) => r.id === s.roomId);
          if (!room) throw new Error("Program room missing");
          return {
            id: s.id,
            title: s.title,
            roomName: room.name,
            venue: room.venue,
            startsAt: s.startsAt,
            endsAt: s.endsAt,
            chairName: s.chairName,
            slots: d.slots
              .filter((slot) => slot.sessionId === s.id)
              .map((slot) => ({
                id: slot.id,
                kind: slot.kind,
                title: slot.title,
                presenterName: slot.presenterName,
                presenterAffiliation: slot.presenterAffiliation,
                startsAt: slot.startsAt,
                endsAt: slot.endsAt,
                posterNumber: slot.posterNumber,
              })),
          };
        });
        const id = await repo.publish(db, d.version, sessions, actor),
          brand = await effectivePublicSite(db, config.CONFERENCE_NAME);
        for (const userId of recipients)
          await enqueueBusinessNotification(
            db,
            { CONFERENCE_NAME: brand.conferenceName },
            {
              userId,
              eventKey: `program:${id}:${userId}`,
              subject: "議程已發布",
              text: `研討會議程已更新，請查看：${config.PUBLIC_APP_ORIGIN}/program`,
              requestId,
            },
          );
        await repo.audit(
          db,
          actor,
          "program.published",
          id,
          d.version,
          requestId,
        );
        return repo.publicProgram(db);
      });
    },
  };
}

import type { Pool, PoolClient } from "pg";
import {
  programDraftSchema,
  programPublicSchema,
  type ProgramDraft,
} from "@confsys/contracts";
import { randomUUID } from "node:crypto";
type Room = ProgramDraft["rooms"][number];
type Session = ProgramDraft["sessions"][number];
type Block = ProgramDraft["blocked"][number];
const timestamp = (value: unknown) => {
  if (!(value instanceof Date)) throw new Error("Invalid program timestamp");
  return value.toISOString();
};
export async function state(db: PoolClient, lock = false) {
  const row = (
    await db.query<{ version: number; active_publication_id: string | null }>(
      `SELECT version,active_publication_id FROM confsys.program_state WHERE singleton=true${lock ? " FOR UPDATE" : ""}`,
    )
  ).rows[0];
  if (!row) throw new Error("Program migration required");
  return row;
}
export async function draft(db: PoolClient) {
  const s = await state(db),
    rooms = (
      await db.query(
        'SELECT id,name,venue,buffer_minutes AS "bufferMinutes" FROM confsys.program_rooms ORDER BY venue,name,id',
      )
    ).rows;
  const blocked = (
    await db.query(
      "SELECT id,room_id AS \"roomId\",starts_at,ends_at,reason FROM confsys.program_room_bookings WHERE kind='blocked' ORDER BY starts_at,id",
    )
  ).rows.map((r) => ({
    id: r.id,
    roomId: r.roomId,
    startsAt: timestamp(r.starts_at),
    endsAt: timestamp(r.ends_at),
    reason: r.reason,
  }));
  const sessions = (
    await db.query(
      'SELECT id,room_id AS "roomId",title,starts_at,ends_at,chair_name AS "chairName",chair_email AS "chairEmail" FROM confsys.program_sessions ORDER BY starts_at,id',
    )
  ).rows.map(({ starts_at, ends_at, ...r }) => ({
    ...r,
    startsAt: timestamp(starts_at),
    endsAt: timestamp(ends_at),
  }));
  const slots = (
    await db.query(
      'SELECT id,session_id AS "sessionId",kind,revision_id AS "revisionId",submission_id AS "submissionId",starts_at,ends_at,poster_number AS "posterNumber",title,presenter_name AS "presenterName",presenter_affiliation AS "presenterAffiliation",presenter_key FROM confsys.program_slots ORDER BY starts_at,id',
    )
  ).rows.map(({ starts_at, ends_at, presenter_key, ...r }) => ({
    ...r,
    startsAt: timestamp(starts_at),
    endsAt: timestamp(ends_at),
    invitedTitle: r.kind === "invited" ? r.title : "",
    invitedSpeaker: r.kind === "invited" ? r.presenterName : "",
    invitedAffiliation: r.kind === "invited" ? r.presenterAffiliation : "",
    invitedEmail: r.kind === "invited" ? presenter_key : "",
  }));
  return programDraftSchema.parse({
    version: s.version,
    activePublicationId: s.active_publication_id,
    rooms,
    blocked,
    sessions,
    slots,
  });
}
export async function publicProgram(db: Pool | PoolClient) {
  const row = (
    await db.query(
      "SELECT p.id,p.document,p.published_at FROM confsys.program_state s JOIN confsys.program_publications p ON p.id=s.active_publication_id WHERE s.singleton=true",
    )
  ).rows[0];
  return programPublicSchema.parse(
    row
      ? {
          publicationId: row.id,
          publishedAt: timestamp(row.published_at),
          sessions: row.document,
        }
      : { publicationId: null, publishedAt: null, sessions: [] },
  );
}
export async function changed(
  db: PoolClient,
  actor: string,
  event: string,
  id: string,
  requestId: string,
) {
  const r = (
    await db.query<{ version: number }>(
      "UPDATE confsys.program_state SET version=version+1 WHERE singleton=true RETURNING version",
    )
  ).rows[0]!;
  await audit(db, actor, event, id, r.version, requestId);
}
export async function audit(
  db: PoolClient,
  actor: string,
  event: string,
  id: string,
  version: number,
  requestId: string,
) {
  await db.query(
    "INSERT INTO confsys.auth_audit(id,event,actor_id,user_id,source,reason,after_value,request_id) VALUES($1,$2,$3,$3,'session','Conference program change',$4,$5)",
    [
      randomUUID(),
      event,
      actor,
      JSON.stringify({ resourceId: id, version }),
      requestId,
    ],
  );
}
export async function saveRoom(db: PoolClient, r: Room) {
  await db.query(
    "INSERT INTO confsys.program_rooms(id,name,venue,buffer_minutes) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET name=excluded.name,venue=excluded.venue,buffer_minutes=excluded.buffer_minutes",
    [r.id, r.name, r.venue, r.bufferMinutes],
  );
}
export async function bookRoom(
  db: PoolClient,
  id: string,
  roomId: string,
  kind: "session" | "blocked",
  start: string,
  end: string,
  buffer: number,
  reason = "",
) {
  await db.query(
    "INSERT INTO confsys.program_room_bookings(id,room_id,kind,starts_at,ends_at,reason) VALUES($1,$2,$3,$4::timestamptz-make_interval(mins=>$6),$5::timestamptz+make_interval(mins=>$6),$7) ON CONFLICT(id) DO UPDATE SET room_id=excluded.room_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,reason=excluded.reason",
    [id, roomId, kind, start, end, buffer, reason],
  );
}
export async function saveBlocked(db: PoolClient, b: Block) {
  await bookRoom(
    db,
    b.id,
    b.roomId,
    "blocked",
    b.startsAt,
    b.endsAt,
    0,
    b.reason,
  );
}
export async function bookPerson(
  db: PoolClient,
  id: string,
  email: string,
  start: string,
  end: string,
) {
  await db.query(
    "DELETE FROM confsys.program_person_bookings WHERE source_id=$1",
    [id],
  );
  await db.query(
    "INSERT INTO confsys.program_person_bookings(source_id,person_key,starts_at,ends_at) VALUES($1,$2,$3,$4)",
    [id, email.trim().toLowerCase(), start, end],
  );
}
export async function saveSession(db: PoolClient, s: Session, buffer: number) {
  await bookRoom(db, s.id, s.roomId, "session", s.startsAt, s.endsAt, buffer);
  await db.query(
    "INSERT INTO confsys.program_sessions(id,room_id,title,starts_at,ends_at,chair_name,chair_email) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET room_id=excluded.room_id,title=excluded.title,starts_at=excluded.starts_at,ends_at=excluded.ends_at,chair_name=excluded.chair_name,chair_email=excluded.chair_email",
    [
      s.id,
      s.roomId,
      s.title,
      s.startsAt,
      s.endsAt,
      s.chairName,
      s.chairEmail.trim().toLowerCase(),
    ],
  );
  await bookPerson(db, s.id, s.chairEmail, s.startsAt, s.endsAt);
}
export type SlotRecord = {
  id: string;
  sessionId: string;
  kind: "oral" | "poster" | "invited";
  revisionId: string | null;
  submissionId: string | null;
  ownerId: string | null;
  title: string;
  presenterName: string;
  presenterAffiliation: string;
  presenterKey: string;
  startsAt: string;
  endsAt: string;
  posterNumber: number | null;
};
export async function saveSlot(db: PoolClient, s: SlotRecord) {
  await db.query(
    "INSERT INTO confsys.program_slots(id,session_id,kind,revision_id,submission_id,owner_id,title,presenter_name,presenter_affiliation,presenter_key,starts_at,ends_at,poster_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT(id) DO UPDATE SET session_id=excluded.session_id,kind=excluded.kind,revision_id=excluded.revision_id,submission_id=excluded.submission_id,owner_id=excluded.owner_id,title=excluded.title,presenter_name=excluded.presenter_name,presenter_affiliation=excluded.presenter_affiliation,presenter_key=excluded.presenter_key,starts_at=excluded.starts_at,ends_at=excluded.ends_at,poster_number=excluded.poster_number",
    [
      s.id,
      s.sessionId,
      s.kind,
      s.revisionId,
      s.submissionId,
      s.ownerId,
      s.title,
      s.presenterName,
      s.presenterAffiliation,
      s.presenterKey,
      s.startsAt,
      s.endsAt,
      s.posterNumber,
    ],
  );
  await bookPerson(db, s.id, s.presenterKey, s.startsAt, s.endsAt);
}
export async function remove(
  db: PoolClient,
  kind: "room" | "blocked" | "session" | "slot",
  id: string,
) {
  if (kind === "room")
    await db.query("DELETE FROM confsys.program_rooms WHERE id=$1", [id]);
  else if (kind === "slot") {
    await db.query(
      "DELETE FROM confsys.program_person_bookings WHERE source_id=$1",
      [id],
    );
    await db.query("DELETE FROM confsys.program_slots WHERE id=$1", [id]);
  } else if (kind === "session") {
    await db.query(
      "DELETE FROM confsys.program_person_bookings WHERE source_id=$1",
      [id],
    );
    await db.query("DELETE FROM confsys.program_sessions WHERE id=$1", [id]);
    await db.query(
      "DELETE FROM confsys.program_room_bookings WHERE id=$1 AND kind='session'",
      [id],
    );
  } else
    await db.query(
      "DELETE FROM confsys.program_room_bookings WHERE id=$1 AND kind='blocked'",
      [id],
    );
}
export async function publish(
  db: PoolClient,
  version: number,
  document: unknown,
  actor: string,
) {
  const id = randomUUID();
  await db.query(
    "INSERT INTO confsys.program_publications(id,source_version,document,published_by) VALUES($1,$2,$3,$4)",
    [id, version, JSON.stringify(document), actor],
  );
  await db.query(
    "INSERT INTO confsys.program_publication_slots(publication_id,slot_id,submission_id,revision_id,presenter_user_id,presenter_change_id) SELECT $1,slot.id,slot.submission_id,slot.revision_id,presenter.presenter_user_id,presenter.presenter_change_id FROM confsys.program_slots slot LEFT JOIN confsys.program_revision_presenters presenter ON presenter.revision_id=slot.revision_id WHERE slot.submission_id IS NOT NULL AND slot.revision_id IS NOT NULL",
    [id],
  );
  await db.query(
    "UPDATE confsys.program_state SET active_publication_id=$1 WHERE singleton=true",
    [id],
  );
  return id;
}
export async function publishedFor(db: PoolClient, version: number) {
  return (
    await db.query<{ id: string }>(
      "SELECT id FROM confsys.program_publications WHERE source_version=$1",
      [version],
    )
  ).rows[0]?.id;
}

export async function personalProgram(db: PoolClient) {
  const publication = await publicProgram(db);
  if (!publication.publicationId) return publication;
  // Explicit actor-only projection preserves ownership and pinned consent identity even if another role broadens raw submission access.
  const rows = await db.query<{ slot_id: string }>(
    "SELECT slot_id FROM confsys.personal_program_slots WHERE publication_id=$1",
    [publication.publicationId],
  );
  const owned = new Set(rows.rows.map((row) => row.slot_id));
  return {
    ...publication,
    sessions: publication.sessions
      .map((session) => ({
        ...session,
        slots: session.slots.filter((slot) => owned.has(slot.id)),
      }))
      .filter((session) => session.slots.length > 0),
  };
}

export async function hasVerifiedAliasConflict(
  db: PoolClient,
  sourceId: string | null = null,
) {
  const r = await db.query(
    `SELECT 1 FROM confsys.program_verified_alias_conflicts
    WHERE $1::uuid IS NULL OR first_source_id=$1 OR second_source_id=$1 LIMIT 1`,
    [sourceId],
  );
  return !!r.rowCount;
}

export async function approvedPresenter(db: PoolClient, revisionId: string) {
  const r = await db.query<{ presenter_user_id: string }>(
    "SELECT presenter_user_id FROM confsys.program_revision_presenters WHERE revision_id=$1",
    [revisionId],
  );
  return r.rows[0]?.presenter_user_id ?? null;
}

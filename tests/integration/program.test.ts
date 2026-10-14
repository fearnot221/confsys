import {withIdentityTransaction} from "@confsys/db";
import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { authFixture, password } from "../helpers/auth.js";
import {
  createAuthService,
  tokenHash,
} from "../../apps/api/src/auth/service.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { createProgramService } from "../../apps/api/src/program/service.js";
import { createSubmissionService } from "../../apps/api/src/submissions/service.js";
import { submissionDependencies } from "../../apps/api/src/submissions/dependencies.js";
import type { ProgramDraft, SubmissionDocument } from "@confsys/contracts";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  program = createProgramService(f.app, f.config),
  submissions = createSubmissionService(
    f.app,
    f.config,
    submissionDependencies,
  ),
  resources: string[] = [];
const id = () => {
  const value = randomUUID();
  resources.push(value);
  return value;
};
async function account() {
  const email = f.email();
  await auth.requestMail("register", email, id());
  await auth.consume("verify", (await f.link(email)).token, password, id());
  const login = await auth.login(email, password, id());
  return { id: login.account.user.id, email, raw: login.raw };
}
let leader: Awaited<ReturnType<typeof account>>,
  author: Awaited<ReturnType<typeof account>>,
  baseline: Record<string, unknown>,
  submissionBaseline: Record<string, unknown>;
const version = async () => (await program.draft(leader.raw)).version;
async function room(bufferMinutes = 0) {
  const item = {
    id: id(),
    name: "Synthetic room",
    venue: "Synthetic venue",
    bufferMinutes,
  };
  await program.room(
    leader.raw,
    { expectedVersion: await version(), item },
    id(),
  );
  return item;
}
async function session(
  roomId: string,
  start = "2030-01-01T01:00:00Z",
  end = "2030-01-01T02:00:00Z",
  chairEmail = `chair-${id()}@example.invalid`,
) {
  const item = {
    id: id(),
    roomId,
    title: "Synthetic session",
    startsAt: start,
    endsAt: end,
    chairName: "Synthetic chair",
    chairEmail,
  };
  await program.session(
    leader.raw,
    { expectedVersion: await version(), item },
    id(),
  );
  return item;
}
function invited(s: ProgramDraft["sessions"][number], patch: object = {}) {
  return {
    id: id(),
    sessionId: s.id,
    kind: "invited",
    revisionId: null,
    startsAt: s.startsAt,
    endsAt: s.endsAt,
    posterNumber: null,
    invitedTitle: "Synthetic lecture",
    invitedSpeaker: "Synthetic speaker",
    invitedAffiliation: "Synthetic institute",
    invitedEmail: `speaker-${id()}@example.invalid`,
    ...patch,
  };
}
beforeAll(async () => {
  f.migrate();
  baseline = (await f.admin.query("SELECT * FROM confsys.program_state"))
    .rows[0];
  submissionBaseline = (
    await f.admin.query("SELECT * FROM confsys.submission_config")
  ).rows[0];
  leader = await account();
  await bootstrapAdministrator(
    f.admin,
    {
      conferenceName: f.config.CONFERENCE_NAME,
      origin: f.config.PUBLIC_APP_ORIGIN,
    },
    {
      targetId: leader.id,
      apply: true,
      reason: "Synthetic program",
      confirmOrigin: f.config.PUBLIC_APP_ORIGIN,
    },
    id(),
  );
  leader.raw = (await auth.login(leader.email, password, id())).raw;
  author = await account();
});
afterAll(async () => {
  await f.admin.query(
    "UPDATE confsys.program_state SET version=$1,active_publication_id=$2",
    [baseline.version, baseline.active_publication_id],
  );
  await f.admin.query(
    "DELETE FROM confsys.program_publication_slots WHERE publication_id IN (SELECT id FROM confsys.program_publications WHERE published_by=$1)",
    [leader.id],
  );
  await f.admin.query(
    "DELETE FROM confsys.program_publications WHERE published_by=$1",
    [leader.id],
  );
  for (const table of [
    "program_person_bookings",
    "program_slots",
    "program_sessions",
    "program_room_bookings",
    "program_rooms",
  ])
    await f.admin.query(
      `DELETE FROM confsys.${table} WHERE ${table === "program_person_bookings" ? "source_id" : "id"}=ANY($1::uuid[])`,
      [resources],
    );
  const paperIds = (
    await f.admin.query(
      "SELECT id FROM confsys.submissions WHERE owner_id=$1",
      [author.id],
    )
  ).rows.map((r) => r.id);
  await f.admin.query(
    "DELETE FROM confsys.review_publications WHERE submission_id=ANY($1::uuid[])",
    [paperIds],
  );
  await f.admin.query(
    "DELETE FROM confsys.review_decisions WHERE submission_id=ANY($1::uuid[])",
    [paperIds],
  );
  await f.admin.query(
    "UPDATE confsys.submissions SET current_revision_id=null,submitted_version=null,state='draft' WHERE owner_id=$1",
    [author.id],
  );
  await f.admin.query(
    "DELETE FROM confsys.submission_revisions WHERE owner_id=$1",
    [author.id],
  );
  await f.admin.query("DELETE FROM confsys.submissions WHERE owner_id=$1", [
    author.id,
  ]);
  await f.admin.query(
    "UPDATE confsys.submission_config SET version=$1,document=$2",
    [submissionBaseline.version, submissionBaseline.document],
  );
  await f.cleanup();
});
it("unauthenticated and ordinary users cannot read drafts or mutate program", async () => {
  for (const raw of [undefined, author.raw]) {
    await expect(program.draft(raw)).rejects.toMatchObject({
      code: raw ? "FORBIDDEN" : "SESSION_EXPIRED",
    });
    await expect(
      program.room(
        raw,
        {
          expectedVersion: 0,
          item: { id: id(), name: "No", venue: "No", bufferMinutes: 0 },
        },
        id(),
      ),
    ).rejects.toMatchObject({ code: raw ? "FORBIDDEN" : "SESSION_EXPIRED" });
  }
  await expect(program.mine(undefined)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  expect(await program.mine(author.raw)).toMatchObject({ sessions: [] });
  expect(await program.public()).toMatchObject({
    publicationId: null,
    sessions: [],
  });
});
it("room buffers, blocked windows, person conflicts and slot containment are enforced transactionally", async () => {
  const a = await room(5),
    b = await room(),
    s = await session(a.id),
    v = await version();
  await expect(
    program.session(
      leader.raw,
      {
        expectedVersion: v,
        item: {
          ...s,
          id: id(),
          startsAt: "2030-01-01T02:05:00Z",
          endsAt: "2030-01-01T03:00:00Z",
        },
      },
      id(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await version()).toBe(v);
  await expect(
    session(b.id, s.startsAt, s.endsAt, s.chairEmail),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await program.blocked(
    leader.raw,
    {
      expectedVersion: await version(),
      item: {
        id: id(),
        roomId: b.id,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        reason: "Synthetic unavailable",
      },
    },
    id(),
  );
  await expect(session(b.id)).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    program.slot(
      leader.raw,
      {
        expectedVersion: await version(),
        item: invited(s, { endsAt: "2030-01-01T02:00:00.001Z" }),
      },
      id(),
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await expect(
    program.slot(
      leader.raw,
      {
        expectedVersion: await version(),
        item: invited(s, { invitedEmail: s.chairEmail }),
      },
      id(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await program.slot(
    leader.raw,
    { expectedVersion: await version(), item: invited(s) },
    id(),
  );
  await expect(
    program.remove(
      leader.raw,
      { expectedVersion: await version(), kind: "session", id: s.id },
      id(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("concurrent edits cannot overwrite; direct app-role exclusion blocks overlapping room reservations", async () => {
  const r = await room(),
    v = await version(),
    first = {
      id: id(),
      roomId: r.id,
      title: "Concurrent A",
      startsAt: "2030-01-02T01:00:00Z",
      endsAt: "2030-01-02T02:00:00Z",
      chairName: "Chair A",
      chairEmail: "concurrent-a@example.invalid",
    };
  const results = await Promise.allSettled([
    program.session(leader.raw, { expectedVersion: v, item: first }, id()),
    program.session(
      leader.raw,
      {
        expectedVersion: v,
        item: {
          ...first,
          id: id(),
          title: "Concurrent B",
          chairEmail: "concurrent-b@example.invalid",
        },
      },
      id(),
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "CONFLICT" },
  });
  await expect(
    withIdentityTransaction(f.app,async db=>{
      await db.query("SELECT set_config('app.program_manage','true',true)");
      return db.query("INSERT INTO confsys.program_room_bookings(id,room_id,kind,starts_at,ends_at) VALUES($1,$2,'blocked',$3,$4)",[id(),r.id,first.startsAt,first.endsAt]);
    }),
  ).rejects.toMatchObject({ code: "23P01" });
});
it("public snapshots omit private emails and remain unchanged after draft edits; repeat publish is stable", async () => {
  const first = await program.publish(
    leader.raw,
    { expectedVersion: await version() },
    id(),
  );
  expect(first.publicationId).not.toBeNull();
  expect(JSON.stringify(first)).not.toMatch(
    /example\.invalid|chairEmail|invitedEmail|revisionId|ownerId/,
  );
  const second = await program.publish(
    leader.raw,
    { expectedVersion: await version() },
    id(),
  );
  expect(second).toEqual(first);
  await room();
  expect(await program.public()).toEqual(first);
  for (const db of [f.app, f.worker])
    await expect(
      db.query(
        "UPDATE confsys.program_publications SET document=document WHERE false",
      ),
    ).rejects.toMatchObject({ code: "42501" });
  await f.admin.query(
    "UPDATE confsys.sessions SET password_verified_at=null WHERE token_hash=$1",
    [tokenHash(leader.raw)],
  );
  await expect(
    program.publish(leader.raw, { expectedVersion: await version() }, id()),
  ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  await auth.reauthenticate(leader.raw, password, id());
});
it("only exact published accepted revision can be scheduled; draft outcomes and withdrawn manuscripts cannot publish", async () => {
  const c = await submissions.config(leader.raw);
  await submissions.configure(
    leader.raw,
    {
      ...c,
      opensAt: new Date(Date.now() - 60000).toISOString(),
      closesAt: new Date(Date.now() + 3600000).toISOString(),
      requireRegistration: false,
      requireAttachment: false,
      tracks: [{ id: "science", name: "Science", topics: [] }],
    },
    id(),
  );
  const document: SubmissionDocument = {
    title: "Accepted synthetic manuscript",
    abstract: "Private abstract never public",
    keywords: [],
    correspondingAuthorIndex: 0,
    trackId: "science",
    topicIds: [],
    authors: [
      {
        name: "Synthetic presenter",
        email: author.email,
        affiliation: "Synthetic institution",
      },
    ],
    presenterIndex: 0,
    presentationPreference: "oral",
    competition: true,
    attachmentIds: [],
    slidesFileId: null,
    videoUrl: "",
  };
  const paper = await submissions.save(
      author.raw,
      { id: id(), expectedVersion: 0, document },
      id(),
    ),
    submitted = await submissions.transition(
      author.raw,
      { id: paper.id, expectedVersion: paper.version, action: "submit" },
      id(),
    ),
    r = await room(),
    s = await session(r.id, "2030-02-01T01:00:00Z", "2030-02-01T02:00:00Z"),
    slot = invited(s, {
      kind: "oral",
      revisionId: submitted.currentRevisionId,
      invitedTitle: "",
      invitedSpeaker: "",
      invitedAffiliation: "",
      invitedEmail: "",
    });
  await expect(
    program.slot(
      leader.raw,
      { expectedVersion: await version(), item: slot },
      id(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const decision = id();
  await f.admin.query(
    "INSERT INTO confsys.review_decisions(id,submission_id,revision_id,version,outcome,author_message,internal_reason,decided_by) VALUES($1,$2,$3,1,'accept_oral','Accepted','Synthetic fixture',$4)",
    [decision, paper.id, submitted.currentRevisionId, leader.id],
  );
  await expect(
    program.slot(
      leader.raw,
      { expectedVersion: await version(), item: slot },
      id(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await f.admin.query(
    "INSERT INTO confsys.review_publications(submission_id,decision_id,published_by) VALUES($1,$2,$3)",
    [paper.id, decision, leader.id],
  );
  await program.slot(
    leader.raw,
    { expectedVersion: await version(), item: slot },
    id(),
  );
  const published = await program.publish(
    leader.raw,
    { expectedVersion: await version() },
    id(),
  );
  expect(JSON.stringify(published)).toContain(document.title);
  expect(JSON.stringify(published)).not.toContain(document.abstract);
  const personal = await program.mine(author.raw);
  expect(personal.sessions).toHaveLength(1);
  expect(personal.sessions[0]?.slots.map((item) => item.id)).toEqual([slot.id]);
  expect(personal.publicationId).toBe(published.publicationId);
  expect(await program.mine(leader.raw)).toMatchObject({ sessions: [] });
  expect(
    (await f.app.query("SELECT * FROM confsys.program_publication_slots")).rows,
  ).toHaveLength(0);
  await expect(
    f.app.query(
      "UPDATE confsys.program_publication_slots SET slot_id=slot_id WHERE false",
    ),
  ).rejects.toMatchObject({ code: "42501" });
  // Operator-only elapsed-policy fixture: published history stays visible while new actions are gated.
  await f.admin.query(
    "UPDATE confsys.submission_revisions SET config_snapshot=jsonb_set(config_snapshot,'{acceptedRegistrationDeadline}',to_jsonb($2::text)) WHERE id=$1",
    [submitted.currentRevisionId, new Date(Date.now() - 1000).toISOString()],
  );
  await expect(
    program.slot(
      leader.raw,
      { expectedVersion: await version(), item: slot },
      id(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await room();
  await expect(
    program.publish(leader.raw, { expectedVersion: await version() }, id()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await program.public()).toEqual(published);
  expect(await program.mine(author.raw)).toEqual(personal);
  await f.admin.query(
    "UPDATE confsys.submission_revisions SET config_snapshot=config_snapshot-'acceptedRegistrationDeadline' WHERE id=$1",
    [submitted.currentRevisionId],
  );
  // A private draft edit cannot move the author's published schedule.
  await program.slot(
    leader.raw,
    {
      expectedVersion: await version(),
      item: {
        ...slot,
        startsAt: "2030-02-01T01:15:00Z",
        endsAt: "2030-02-01T01:45:00Z",
      },
    },
    id(),
  );
  expect(await program.mine(author.raw)).toEqual(personal);
  const event = await f.admin.query(
    "SELECT count(*) FROM confsys.notifications WHERE event_key=$1",
    [`program:${published.publicationId}:${author.id}`],
  );
  expect(event.rows[0].count).toBe("1");
  await room();
  const pendingVersion = await version();
  await f.admin.query(
    "DELETE FROM confsys.review_publications WHERE submission_id=$1",
    [paper.id],
  );
  await expect(
    program.publish(leader.raw, { expectedVersion: pendingVersion }, id()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await f.admin.query(
    "INSERT INTO confsys.review_publications(submission_id,decision_id,published_by) VALUES($1,$2,$3)",
    [paper.id, decision, leader.id],
  );
  const blocker = await f.admin.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM confsys.users WHERE id=$1 FOR UPDATE", [
    author.id,
  ]);
  const withdrawal = submissions.transition(
    author.raw,
    { id: paper.id, expectedVersion: paper.version, action: "withdraw" },
    id(),
  );
  let publishing: Promise<unknown> | undefined;
  try {
    await expect
      .poll(async () =>
        Number(
          (
            await f.app.query(
              "SELECT count(*) FROM pg_stat_activity WHERE usename='confsys_app' AND wait_event_type='Lock'",
            )
          ).rows[0].count,
        ),
      )
      .toBeGreaterThan(0);
    publishing = program.publish(
      leader.raw,
      { expectedVersion: pendingVersion },
      id(),
    );
    const rejection = expect(publishing).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await blocker.query("COMMIT");
    await withdrawal;
    await rejection;
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled([withdrawal, ...(publishing ? [publishing] : [])]);
  }
  expect(await program.public()).toEqual(published);
  expect(await program.mine(author.raw)).toEqual(personal);
});
it("personal schedule HTTP requires authentication and keeps the filtered response private", async () => {
  const { buildApp } = await import("../../apps/api/src/app.js");
  const { registerAuthRoutes } =
    await import("../../apps/api/src/auth/routes.js");
  const { registerProgramRoutes } =
    await import("../../apps/api/src/program/routes.js");
  const { createRateLimiter } =
    await import("../../apps/api/src/auth/rate-limit.js");
  const { Redis } = await import("ioredis");
  const redis = new Redis(f.config.REDIS_URL);
  const up = async () => {};
  const server = buildApp({ postgres: up, redis: up, worker: up });
  await registerAuthRoutes(server, {
    config: f.config,
    service: auth,
    limit: createRateLimiter(
      redis,
      f.config.CSRF_SIGNING_KEY,
      `program-${id()}`,
    ),
  });
  registerProgramRoutes(server, f.config, program);
  const host = new URL(f.config.PUBLIC_APP_ORIGIN).host;
  try {
    expect(
      (await server.inject({ url: "/api/program/mine", headers: { host } }))
        .statusCode,
    ).toBe(401);
    const result = await server.inject({
      url: "/api/program/mine",
      headers: { host, cookie: `dev-session=${author.raw}` },
    });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toEqual(await program.mine(author.raw));
    expect(result.headers["cache-control"]).toBe("no-store");
    expect(result.headers["x-robots-tag"]).toBe("noindex, nofollow");
    expect(JSON.stringify(result.json())).not.toMatch(
      /ownerId|submissionId|revisionId|example\.invalid/,
    );
  } finally {
    await server.close();
    await redis.quit();
  }
});

it("draft RLS denies context-free reads/writes while active public projection remains available",async()=>{
 const draftRoom=await room();
 for(const table of ['program_rooms','program_sessions','program_slots','program_room_bookings','program_person_bookings'])
  expect((await f.app.query(`SELECT * FROM confsys.${table}`)).rows).toEqual([]);
 expect((await f.app.query("UPDATE confsys.program_rooms SET name='forged' WHERE id=$1",[draftRoom.id])).rowCount).toBe(0);
 expect((await f.app.query("DELETE FROM confsys.program_rooms WHERE id=$1",[draftRoom.id])).rowCount).toBe(0);
 await expect(f.app.query("INSERT INTO confsys.program_rooms(id,name,venue,buffer_minutes) VALUES($1,'forged','forged',0)",[id()])).rejects.toMatchObject({code:'42501'});
 expect((await f.app.query("UPDATE confsys.program_state SET version=version+1")).rowCount).toBe(0);
 const hidden=id();
 await f.admin.query("INSERT INTO confsys.program_publications(id,source_version,document,published_by) VALUES($1,2147483647,'[]',$2)",[hidden,leader.id]);
 expect((await f.app.query("SELECT id FROM confsys.program_publications WHERE id=$1",[hidden])).rows).toEqual([]);
 const visible=await program.public();
 expect((await f.app.query("SELECT id FROM confsys.program_publications")).rows.map(r=>r.id)).toEqual(visible.publicationId?[visible.publicationId]:[]);
 expect((await program.draft(leader.raw)).rooms.some(r=>r.id===draftRoom.id)).toBe(true);
});

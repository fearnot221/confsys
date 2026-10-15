import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { createCompetitionService } from "../../apps/api/src/competitions/service.js";
import { createSubmissionService } from "../../apps/api/src/submissions/service.js";
import { submissionDependencies } from "../../apps/api/src/submissions/dependencies.js";
import { withIdentityTransaction } from "@confsys/db";
import type { CompetitionConfig, SubmissionDocument } from "@confsys/contracts";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  svc = createCompetitionService(f.app, f.config),
  submissions = createSubmissionService(
    f.app,
    f.config,
    submissionDependencies,
  ),
  id = () => randomUUID(),
  competitionIds: string[] = [];
let registrationVersion: number | undefined;
async function account() {
  const email = f.email();
  await auth.requestMail("register", email, id());
  await auth.consume("verify", (await f.link(email)).token, password, id());
  const login = await auth.login(email, password, id());
  return { id: login.account.user.id, email, raw: login.raw };
}
let leader: Awaited<ReturnType<typeof account>>,
  author: Awaited<ReturnType<typeof account>>,
  judge: Awaited<ReturnType<typeof account>>,
  otherJudge: Awaited<ReturnType<typeof account>>,
  baseline: { version: number; document: unknown };
const cfg = (patch: Partial<CompetitionConfig> = {}): CompetitionConfig => ({
  name: "Synthetic competition",
  kind: "oral",
  registrationClosesAt: new Date(Date.now() + 3600000).toISOString(),
  judgingClosesAt: new Date(Date.now() + 7200000).toISOString(),
  requireRegistration: false,
  minimumJudges: 1,
  tiePolicy: "shared",
  eligibilityNote: "Published accepted and competition opt in",
  criteria: [{ id: "quality", label: "Quality", maximum: 100, weight: 1 }],
  ...patch,
});
const current = async (compId: string) =>
  (await svc.admin(leader.raw)).competitions.find((c) => c.id === compId)!;
async function competition(patch: Partial<CompetitionConfig> = {}) {
  const compId = id();
  competitionIds.push(compId);
  await svc.configure(
    leader.raw,
    { id: compId, expectedVersion: 0, config: cfg(patch) },
    id(),
  );
  return compId;
}
async function close(compId: string) {
  const c = await current(compId);
  await svc.configure(
    leader.raw,
    {
      id: compId,
      expectedVersion: c.version,
      config: {
        ...c.config,
        registrationClosesAt: new Date(Date.now() - 1000).toISOString(),
      },
    },
    id(),
  );
}
async function paper(patch: Partial<SubmissionDocument> = {}) {
  const document: SubmissionDocument = {
    title: "Synthetic competitive manuscript",
    abstract: "Private unpublished abstract",
    keywords: [],
    correspondingAuthorIndex: 0,
    trackId: "science",
    topicIds: [],
    authors: [
      {
        name: "Synthetic Presenter",
        email: author.email,
        affiliation: "Synthetic institute",
      },
    ],
    presenterIndex: 0,
    presentationPreference: "oral",
    competition: true,
    attachmentIds: [],
    slidesFileId: null,
    videoUrl: "",
    ...patch,
  };
  const p = await submissions.save(
      author.raw,
      { id: id(), expectedVersion: 0, document },
      id(),
    ),
    s = await submissions.transition(
      author.raw,
      { id: p.id, expectedVersion: p.version, action: "submit" },
      id(),
    ),
    decisionId = id();
  await f.admin.query(
    "INSERT INTO confsys.review_decisions(id,submission_id,revision_id,version,outcome,author_message,internal_reason,decided_by) VALUES($1,$2,$3,1,'accept_oral','Accepted','Synthetic competition fixture',$4)",
    [decisionId, p.id, s.currentRevisionId, leader.id],
  );
  await f.admin.query(
    "INSERT INTO confsys.review_publications(submission_id,decision_id,published_by) VALUES($1,$2,$3)",
    [p.id, decisionId, leader.id],
  );
  return s;
}
async function enroll(compId: string, p: Awaited<ReturnType<typeof paper>>) {
  const result = await svc.enroll(
    author.raw,
    { competitionId: compId, revisionId: p.currentRevisionId },
    id(),
  );
  return result.entries.find(
    (e) => e.competitionId === compId && e.submissionId === p.id,
  )!;
}
async function approve(e: Awaited<ReturnType<typeof enroll>>) {
  return svc.entry(
    leader.raw,
    {
      id: e.id,
      expectedVersion: e.version,
      action: "approve",
      reason: "Confirmed synthetic eligibility",
    },
    id(),
  );
}
async function assignment(entryId: string, judgeId = judge.id) {
  await svc.assign(leader.raw, { entryId, judgeId }, id());
  return (
    await svc.judging(judgeId === judge.id ? judge.raw : otherJudge.raw)
  ).assignments.find((a) => a.entryId === entryId)!;
}
async function submit(
  a: Awaited<ReturnType<typeof assignment>>,
  value = 80,
  raw = judge.raw,
) {
  return svc.score(
    raw,
    {
      assignmentId: a.id,
      expectedVersion: a.version,
      action: "submit",
      document: {
        scores: [{ criterionId: "quality", value }],
        comment: "Private judge comment",
      },
    },
    id(),
  );
}
beforeAll(async () => {
  f.migrate();
  baseline = (
    await f.admin.query(
      "SELECT version,document FROM confsys.submission_config",
    )
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
      reason: "Synthetic competition fixture",
      confirmOrigin: f.config.PUBLIC_APP_ORIGIN,
    },
    id(),
  );
  leader.raw = (await auth.login(leader.email, password, id())).raw;
  author = await account();
  judge = await account();
  otherJudge = await account();
  for (const u of [judge, otherJudge, author]) {
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'competition_judge')",
      [u.id],
    );
    u.raw = (await auth.login(u.email, password, id())).raw;
  }
  const c = await submissions.config(leader.raw);
  await submissions.configure(
    leader.raw,
    {
      ...c,
      opensAt: new Date(Date.now() - 10000).toISOString(),
      closesAt: new Date(Date.now() + 3600000).toISOString(),
      requireRegistration: false,
      requireAttachment: false,
      tracks: [{ id: "science", name: "Science", topics: [] }],
    },
    id(),
  );
});
afterAll(async () => {
  await f.admin.query(
    "DELETE FROM confsys.competition_deadline_extensions WHERE assignment_id IN(SELECT id FROM confsys.competition_assignments WHERE competition_id=ANY($1::uuid[]))",
    [competitionIds],
  );
  if (leader) {
    await f.admin.query(
      "UPDATE confsys.competitions SET active_publication_id=null,current_rubric_id=null WHERE id=ANY($1::uuid[])",
      [competitionIds],
    );
    await f.admin.query(
      "DELETE FROM confsys.competition_scores WHERE assignment_id IN(SELECT id FROM confsys.competition_assignments WHERE competition_id=ANY($1::uuid[]))",
      [competitionIds],
    );
    for (const table of [
      "competition_publications",
      "competition_conflicts",
      "competition_assignments",
      "competition_entries",
      "competition_rubrics",
    ])
      await f.admin.query(
        `DELETE FROM confsys.${table} WHERE competition_id=ANY($1::uuid[])`,
        [competitionIds],
      );
    await f.admin.query(
      "DELETE FROM confsys.competitions WHERE id=ANY($1::uuid[])",
      [competitionIds],
    );
    if (author) {
      await f.admin.query(
        "DELETE FROM confsys.registrations WHERE user_id=$1",
        [author.id],
      );
      if (registrationVersion)
        await f.admin.query(
          "DELETE FROM confsys.registration_config_versions WHERE version=$1",
          [registrationVersion],
        );
      const ids = (
        await f.admin.query(
          "SELECT id FROM confsys.submissions WHERE owner_id=$1",
          [author.id],
        )
      ).rows.map((r) => r.id);
      await f.admin.query(
        "DELETE FROM confsys.presenter_change_requests WHERE submission_id=ANY($1::uuid[])",
        [ids],
      );
      for (const table of ["review_publications", "review_decisions"])
        await f.admin.query(
          `DELETE FROM confsys.${table} WHERE submission_id=ANY($1::uuid[])`,
          [ids],
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
    }
    if (baseline)
      await f.admin.query(
        "UPDATE confsys.submission_config SET version=$1,document=$2",
        [baseline.version, baseline.document],
      );
  }
  await f.cleanup();
});
it("denies ordinary administrative access and judge access to another assignment; exact acceptance and opt-in required", async () => {
  await expect(svc.admin(author.raw)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(svc.catalog(undefined)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  const c = await competition(),
    p = await paper({ competition: false });
  await expect(enroll(c, p)).rejects.toMatchObject({ code: "CONFLICT" });
  const accepted = await paper(),
    e = await enroll(c, accepted);
  expect((await enroll(c, accepted)).id).toBe(e.id);
  await expect(
    svc.enroll(
      judge.raw,
      { competitionId: c, revisionId: accepted.currentRevisionId },
      id(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await approve(e);
  const a = await assignment(e.id);
  await expect(submit(a, 80, otherJudge.raw)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    (await svc.judging(otherJudge.raw)).assignments.some((v) => v.id === a.id),
  ).toBe(false);
  await withIdentityTransaction(f.app, async (db) => {
    expect(
      (
        await db.query(
          "SELECT id FROM confsys.competition_assignments WHERE id=$1",
          [a.id],
        )
      ).rows,
    ).toEqual([]);
    expect(
      (
        await db.query(
          "SELECT id FROM confsys.competition_entries WHERE id=$1",
          [e.id],
        )
      ).rows,
    ).toEqual([]);
  });
});
it("checks self/coauthor conflicts, final score completeness, immutability and replay", async () => {
  const c = await competition(),
    p = await paper({
      authors: [
        { name: "Presenter", email: author.email, affiliation: "Institute" },
        {
          name: "Coauthor judge",
          email: otherJudge.email,
          affiliation: "Institute",
        },
      ],
    }),
    e = await approve(await enroll(c, p));
  await expect(
    svc.assign(leader.raw, { entryId: e.id, judgeId: author.id }, id()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    svc.assign(leader.raw, { entryId: e.id, judgeId: otherJudge.id }, id()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const a = await assignment(e.id);
  await expect(
    svc.score(
      judge.raw,
      {
        assignmentId: a.id,
        expectedVersion: a.version,
        action: "submit",
        document: { scores: [], comment: "" },
      },
      id(),
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await submit(a);
  await submit(a);
  await expect(submit(a, 70)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM confsys.competition_scores WHERE assignment_id=$1",
        [a.id],
      )
    ).rows[0].count,
  ).toBe("1");
  await expect(
    f.app.query(
      "UPDATE confsys.competition_scores SET points=0 WHERE assignment_id=$1",
      [a.id],
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await svc.conflict(
    judge.raw,
    { assignmentId: a.id, reason: "Later discovered affiliation conflict" },
    id(),
  );
  expect(
    (await svc.admin(leader.raw, c)).totals.find((t) => t.entryId === e.id),
  ).toMatchObject({ submitted: 0, basisPoints: null });
});
it("publishes immutable explicit award snapshot only after complete scores; exact shared ties require equal rank", async () => {
  const c = await competition(),
    p1 = await paper(),
    p2 = await paper(),
    e1 = await approve(await enroll(c, p1)),
    e2 = await approve(await enroll(c, p2));
  await close(c);
  const a1 = await assignment(e1.id),
    a2 = await assignment(e2.id);
  await submit(a1);
  const saveAwards = async (
    awards: { entryId: string; label: string; rank: number }[],
  ) =>
    svc.awards(
      leader.raw,
      {
        competitionId: c,
        expectedVersion: (await current(c)).version,
        awards,
        reason: "Synthetic shared-score adjudication",
      },
      id(),
    );
  const publish = async () =>
    svc.publish(
      leader.raw,
      { competitionId: c, expectedVersion: (await current(c)).version },
      id(),
    );
  await saveAwards([{ entryId: e1.id, label: "Best paper", rank: 1 }]);
  await expect(publish()).rejects.toMatchObject({ code: "CONFLICT" });
  await submit(a2);
  await expect(publish()).rejects.toMatchObject({ code: "CONFLICT" });
  await saveAwards([
    { entryId: e1.id, label: "Best paper", rank: 1 },
    { entryId: e2.id, label: "Best paper", rank: 1 },
  ]);
  const result = await publish(),
    published = result.competitions.find((v) => v.id === c)!;
  expect(published.awards).toHaveLength(2);
  expect(JSON.stringify(published)).not.toContain("Private");
  expect(JSON.stringify(published)).not.toContain(author.email);
  expect(
    (await publish()).competitions.find((v) => v.id === c)?.publicationId,
  ).toBe(published.publicationId);
  await svc.entry(
    leader.raw,
    {
      id: e1.id,
      expectedVersion: e1.version,
      action: "disqualify",
      reason: "Synthetic later eligibility correction",
    },
    id(),
  );
  expect((await svc.public()).competitions.find((v) => v.id === c)).toEqual(
    published,
  );
  await expect(publish()).rejects.toMatchObject({ code: "CONFLICT" });
});
it("withdrawn manuscripts and revoked judge roles prevent score mutation", async () => {
  const c = await competition(),
    p = await paper(),
    e = await approve(await enroll(c, p)),
    a = await assignment(e.id);
  await submissions.transition(
    author.raw,
    { id: p.id, expectedVersion: p.version, action: "withdraw" },
    id(),
  );
  await expect(submit(a)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await f.admin.query(
    "DELETE FROM confsys.user_roles WHERE user_id=$1 AND role='competition_judge'",
    [judge.id],
  );
  await expect(svc.judging(judge.raw)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'competition_judge')",
    [judge.id],
  );
});

it("registration eligibility projection permits qualified owner/admin/judge without exposing registrations", async () => {
  const c = await competition({ requireRegistration: true }),
    p = await paper();
  await expect(enroll(c, p)).rejects.toMatchObject({ code: "CONFLICT" });
  registrationVersion = Number(
    (
      await f.admin.query(
        "SELECT coalesce(max(version),0)+1 AS version FROM confsys.registration_config_versions",
      )
    ).rows[0].version,
  );
  await f.admin.query(
    "INSERT INTO confsys.registration_config_versions(version,document,created_by) VALUES($1,$2,$3)",
    [registrationVersion, {}, leader.id],
  );
  const registrationId = id();
  await f.admin.query(
    "INSERT INTO confsys.registrations(id,user_id,config_version,ticket_id,ticket_name,state,badge_name,affiliation,answers,consent_snapshot,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'Synthetic','confirmed','Synthetic','Institute','{}','Synthetic consent',$5,'synthetic')",
    [registrationId, author.id, registrationVersion, id(), id()],
  );
  const e = await approve(await enroll(c, p)),
    a = await assignment(e.id);
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [judge.id]);
    expect(
      (
        await db.query("SELECT id FROM confsys.registrations WHERE id=$1", [
          registrationId,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.query(
          "SELECT * FROM confsys.competition_registration_eligibility WHERE user_id=$1",
          [author.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  await svc.score(
    judge.raw,
    {
      assignmentId: a.id,
      expectedVersion: a.version,
      action: "save",
      document: {
        scores: [{ criterionId: "quality", value: 50 }],
        comment: "",
      },
    },
    id(),
  );
  await f.admin.query(
    "UPDATE confsys.registrations SET state='cancelled' WHERE id=$1",
    [registrationId],
  );
  const latest = (await svc.judging(judge.raw)).assignments.find(
    (v) => v.id === a.id,
  )!;
  await expect(submit(latest)).rejects.toMatchObject({ code: "FORBIDDEN" });
});
it("HTTP uses strict contracts, CSRF protection and private no-store projections", async () => {
  const { buildApp } = await import("../../apps/api/src/app.js"),
    { registerAuthRoutes } = await import("../../apps/api/src/auth/routes.js"),
    { registerCompetitionRoutes } =
      await import("../../apps/api/src/competitions/routes.js"),
    { createRateLimiter } =
      await import("../../apps/api/src/auth/rate-limit.js"),
    { Redis } = await import("ioredis");
  const redis = new Redis(f.config.REDIS_URL),
    up = async () => {},
    server = buildApp({ postgres: up, redis: up, worker: up });
  await registerAuthRoutes(server, {
    config: f.config,
    service: auth,
    limit: createRateLimiter(
      redis,
      f.config.CSRF_SIGNING_KEY,
      `competition-${id()}`,
    ),
  });
  registerCompetitionRoutes(server, f.config, svc);
  const host = new URL(f.config.PUBLIC_APP_ORIGIN).host;
  try {
    const csrf = await server.inject({
        url: "/api/auth/csrf",
        headers: { host },
      }),
      cookie = csrf.cookies.map((c) => `${c.name}=${c.value}`).join("; "),
      headers = {
        host,
        cookie: `dev-session=${leader.raw}; ${cookie}`,
        origin: f.config.PUBLIC_APP_ORIGIN,
        "x-csrf-token": csrf.json().csrfToken,
      };
    const compId = id(),
      payload = { id: compId, expectedVersion: 0, config: cfg() };
    competitionIds.push(compId);
    for (const extra of [
      { origin: "https://evil.invalid" },
      { "x-csrf-token": "" },
    ])
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/competitions/configure",
            headers: { ...headers, ...extra },
            payload,
          })
        ).statusCode,
      ).toBe(403);
    expect(
      (
        await server.inject({
          method: "POST",
          url: "/api/competitions/configure",
          headers,
          payload: { ...payload, ownerId: author.id },
        })
      ).statusCode,
    ).toBe(400);
    const created = await server.inject({
      method: "POST",
      url: "/api/competitions/configure",
      headers,
      payload,
    });
    expect(created.statusCode).toBe(200);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.headers["x-robots-tag"]).toContain("noindex");
    expect(
      (
        await server.inject({
          url: "/api/competitions/admin?offset=-1",
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await server.inject({
          url: "/api/competitions/admin",
          headers: { host, cookie: `dev-session=${author.raw}` },
        })
      ).statusCode,
    ).toBe(403);
    const publicResponse = await server.inject({
      url: "/api/competitions/awards",
      headers: { host },
    });
    expect(publicResponse.statusCode).toBe(200);
    expect(JSON.stringify(publicResponse.json())).not.toContain(
      "Private judge comment",
    );
  } finally {
    await server.close();
    await redis.quit();
  }
});

it("pending-score reminders are authorized and retry-safe without unpublished details", async () => {
  const c = await competition(),
    p = await paper(),
    e = await approve(await enroll(c, p)),
    a = await assignment(e.id),
    input = {
      assignmentId: a.id,
      idempotencyKey: id(),
      reason: "Synthetic missing score reminder",
    };
  await expect(svc.remind(author.raw, input, id())).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await svc.remind(leader.raw, input, id());
  await svc.remind(leader.raw, input, id());
  const rows = (
    await f.admin.query(
      "SELECT message_text,message_subject FROM confsys.notifications WHERE event_key=$1",
      [`competition-reminder:${a.id}:${input.idempotencyKey}`],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(rows[0].message_subject).toContain("待評分");
  expect(rows[0].message_text).not.toContain(p.document.title);
  await submit(a);
  await expect(
    svc.remind(leader.raw, { ...input, idempotencyKey: id() }, id()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});

it("publication fences an in-flight author withdrawal and leaves public snapshot unchanged", async () => {
  const c = await competition(),
    p = await paper(),
    e = await approve(await enroll(c, p));
  await close(c);
  const a = await assignment(e.id);
  await submit(a);
  await svc.awards(
    leader.raw,
    {
      competitionId: c,
      expectedVersion: (await current(c)).version,
      awards: [{ entryId: e.id, label: "Synthetic winner", rank: 1 }],
      reason: "Synthetic concurrency award",
    },
    id(),
  );
  const expectedVersion = (await current(c)).version,
    before = await svc.public();
  const blocker = await f.admin.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM confsys.users WHERE id=$1 FOR UPDATE", [
    author.id,
  ]);
  const withdrawal = submissions.transition(
    author.raw,
    { id: p.id, expectedVersion: p.version, action: "withdraw" },
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
    publishing = svc.publish(
      leader.raw,
      { competitionId: c, expectedVersion },
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
  expect(await svc.public()).toEqual(before);
  expect(
    (
      await f.admin.query(
        "SELECT id FROM confsys.competition_publications WHERE competition_id=$1",
        [c],
      )
    ).rowCount,
  ).toBe(0);
});
it("a queued judge score rechecks qualification after an author withdrawal commits", async () => {
  const c = await competition(),
    p = await paper(),
    e = await approve(await enroll(c, p)),
    a = await assignment(e.id),
    blocker = await f.admin.connect();
  await blocker.query("BEGIN");
  await blocker.query("SELECT id FROM confsys.users WHERE id=$1 FOR UPDATE", [
    author.id,
  ]);
  const withdrawal = submissions.transition(
    author.raw,
    { id: p.id, expectedVersion: p.version, action: "withdraw" },
    id(),
  );
  let scoring: Promise<unknown> | undefined;
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
    scoring = submit(a);
    const rejection = expect(scoring).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await blocker.query("COMMIT");
    await withdrawal;
    await rejection;
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled([withdrawal, ...(scoring ? [scoring] : [])]);
  }
  expect(
    (
      await f.admin.query(
        "SELECT id FROM confsys.competition_scores WHERE assignment_id=$1",
        [a.id],
      )
    ).rowCount,
  ).toBe(0);
});

it("pinned post-acceptance registration deadline gates competition actions independently of competition registration rules", async () => {
  const c = await competition({ requireRegistration: false });
  const p = await paper();
  const e = await approve(await enroll(c, p));
  const a = await assignment(e.id);
  // Operator-only historical fixture models a deadline that elapsed after an assignment was accepted.
  await f.admin.query(
    "UPDATE confsys.submission_revisions SET config_snapshot=jsonb_set(config_snapshot,'{acceptedRegistrationDeadline}',to_jsonb($2::text)) WHERE id=$1",
    [p.currentRevisionId, new Date(Date.now() - 1000).toISOString()],
  );
  const another = await competition({ requireRegistration: false });
  await expect(enroll(another, p)).rejects.toMatchObject({ code: "CONFLICT" });
  // Assigned judging eligibility failures use the established FORBIDDEN response.
  await expect(submit(a)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [judge.id]);
    expect(
      (
        await db.query(
          "SELECT * FROM confsys.submission_registration_status WHERE revision_id=$1",
          [p.currentRevisionId],
        )
      ).rows,
    ).toHaveLength(0);
    expect(
      (
        await db.query(
          "SELECT eligible FROM confsys.competition_judging_eligibility WHERE id=$1",
          [a.id],
        )
      ).rows[0],
    ).toEqual({ eligible: false });
  });
  if (
    !(
      await f.admin.query(
        "SELECT 1 FROM confsys.registrations WHERE user_id=$1",
        [author.id],
      )
    ).rowCount
  ) {
    registrationVersion = Number(
      (
        await f.admin.query(
          "SELECT coalesce(max(version),0)+1 AS version FROM confsys.registration_config_versions",
        )
      ).rows[0].version,
    );
    await f.admin.query(
      "INSERT INTO confsys.registration_config_versions(version,document,created_by) VALUES($1,'{}',$2)",
      [registrationVersion, leader.id],
    );
    await f.admin.query(
      "INSERT INTO confsys.registrations(id,user_id,config_version,ticket_id,ticket_name,state,badge_name,affiliation,answers,consent_snapshot,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'Synthetic','cancelled','Synthetic','Institute','{}','Synthetic consent',$5,'synthetic')",
      [id(), author.id, registrationVersion, id(), id()],
    );
  }
  // Registration is confirmed late, without changing the immutable deadline or pretending payment happened.
  await f.admin.query(
    "UPDATE confsys.registrations SET state='confirmed' WHERE user_id=$1",
    [author.id],
  );
  expect(
    (await submissions.detail(author.raw, p.id, "own")).registrationRequirement,
  ).toMatchObject({ state: "satisfied", registered: true });
  await submit(a);
});

it("historical verified coauthor aliases fence competition assignment and persisted judging eligibility", async () => {
  const alias = await account();
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'competition_judge')",
    [alias.id],
  );
  const comp = await competition(),
    p = await paper({
      authors: [
        { name: "Presenter", email: author.email, affiliation: "Synthetic" },
        { name: "Coauthor", email: alias.email, affiliation: "Synthetic" },
      ],
    }),
    entry = await approve(await enroll(comp, p));
  const target = f.email();
  await auth.requestEmailChange(alias.raw, target, id());
  await auth.confirmEmailChange(
    alias.raw,
    { token: (await f.link(alias.email, "email_change")).token },
    id(),
  );
  const fresh = await auth.login(target, password, id());
  await expect(
    svc.assign(leader.raw, { entryId: entry.id, judgeId: alias.id }, id()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  // Operator-only historic assignment fixture verifies read/score fencing independently of assignment validation.
  const aid = id(),
    rubric = (await current(comp)).currentRubricId;
  await f.admin.query(
    "INSERT INTO confsys.competition_assignments(id,entry_id,competition_id,judge_id,rubric_id) VALUES($1,$2,$3,$4,$5)",
    [aid, entry.id, comp, alias.id, rubric],
  );
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [alias.id]);
    expect(
      (
        await db.query(
          "SELECT eligible FROM confsys.competition_judging_eligibility WHERE id=$1",
          [aid],
        )
      ).rows[0].eligible,
    ).toBe(false);
  });
  expect(
    (await svc.judging(fresh.raw)).assignments.some((a) => a.id === aid),
  ).toBe(false);
  await expect(
    svc.score(
      fresh.raw,
      {
        assignmentId: aid,
        expectedVersion: 1,
        action: "submit",
        document: {
          scores: [{ criterionId: "quality", value: 80 }],
          comment: "Synthetic",
        },
      },
      id(),
    ),
  ).rejects.toBeDefined();
});
it("creates an idempotent presenter successor with fresh qualification and scoring while retaining immutable history", async () => {
  const target = await account();
  const c = await competition();
  const p = await paper({
    authors: [
      {
        name: "Original presenter",
        email: author.email,
        affiliation: "Institute",
      },
      {
        name: "Replacement presenter",
        email: target.email,
        affiliation: "Institute",
      },
    ],
  });
  const previous = await approve(await enroll(c, p));
  const oldAssignment = await assignment(previous.id);
  await submit(oldAssignment, 80);
  const newRevisionId = id(),
    decisionId = id(),
    changeId = id();
  const source = (
    await f.admin.query(
      "SELECT * FROM confsys.submission_revisions WHERE id=$1",
      [p.currentRevisionId],
    )
  ).rows[0];
  await f.admin.query(
    "INSERT INTO confsys.submission_revisions(id,submission_id,owner_id,version,document,config_snapshot) VALUES($1,$2,$3,$4,$5,$6)",
    [
      newRevisionId,
      p.id,
      author.id,
      source.version + 1,
      { ...source.document, presenterIndex: 1 },
      source.config_snapshot,
    ],
  );
  await f.admin.query(
    "UPDATE confsys.submissions SET current_revision_id=$2,submitted_version=$3,version=version+1,document=$4 WHERE id=$1",
    [
      p.id,
      newRevisionId,
      source.version + 1,
      { ...source.document, presenterIndex: 1 },
    ],
  );
  await f.admin.query(
    "INSERT INTO confsys.review_decisions(id,submission_id,revision_id,version,outcome,author_message,internal_reason,decided_by) VALUES($1,$2,$3,2,'accept_oral','Accepted replacement','Synthetic successor fixture',$4)",
    [decisionId, p.id, newRevisionId, leader.id],
  );
  await f.admin.query(
    "UPDATE confsys.review_publications SET decision_id=$2 WHERE submission_id=$1",
    [p.id, decisionId],
  );
  const request = {
    predecessorId: previous.id,
    expectedVersion: previous.version,
    revisionId: newRevisionId,
    reason: "Approved presenter replacement",
  };
  // Acceptance of an arbitrary new content revision is insufficient.
  await expect(
    svc.replaceEntry(author.raw, request, id()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await f.admin.query(
    `INSERT INTO confsys.presenter_change_requests(id,submission_id,source_revision_id,expected_submission_version,config_version,requester_id,target_user_id,target_author_index,target_email,projection,reason,state,consent_credential_version,consented_at,decision_actor,decision_reason,decided_at,new_revision_id,expires_at)
    VALUES($1,$2,$3,$4,0,$5,$6,1,$7,'{}','Synthetic consent fixture','approved',1,now(),$8,'Approved fixture',now(),$9,now()+interval '1 day')`,
    [
      changeId,
      p.id,
      p.currentRevisionId,
      p.version,
      author.id,
      target.id,
      target.email,
      leader.id,
      newRevisionId,
    ],
  );
  await expect(
    svc.replaceEntry(otherJudge.raw, request, id()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    svc.replaceEntry(author.raw, { ...request, expectedVersion: 999 }, id()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const outcomes = await Promise.all([
    svc.replaceEntry(author.raw, request, id()),
    svc.replaceEntry(leader.raw, request, id()),
  ]);
  expect(outcomes[0].id).toBe(outcomes[1].id);
  const successor = outcomes[0];
  expect(successor).toMatchObject({
    predecessorId: previous.id,
    revisionId: newRevisionId,
    state: "requested",
    presenterName: "Replacement presenter",
  });
  expect(
    (
      await f.admin.query(
        "SELECT state,version,revision_id FROM confsys.competition_entries WHERE id=$1",
        [previous.id],
      )
    ).rows[0],
  ).toEqual({
    state: previous.state,
    version: previous.version,
    revision_id: previous.revisionId,
  });
  expect(
    (
      await f.admin.query(
        "SELECT id FROM confsys.competition_scores WHERE assignment_id=$1",
        [oldAssignment.id],
      )
    ).rowCount,
  ).toBe(1);
  expect(
    (
      await f.admin.query(
        "SELECT id FROM confsys.competition_assignments WHERE entry_id=$1",
        [successor.id],
      )
    ).rowCount,
  ).toBe(0);
  await expect(
    svc.entry(
      author.raw,
      {
        id: previous.id,
        expectedVersion: previous.version,
        action: "withdraw",
        reason: "Historical entry",
      },
      id(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    svc.conflict(
      judge.raw,
      { assignmentId: oldAssignment.id, reason: "Historical assignment" },
      id(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    svc.assign(leader.raw, { entryId: successor.id, judgeId: judge.id }, id()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const approved = await approve(successor),
    freshAssignment = await assignment(approved.id);
  await submit(freshAssignment, 90);
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int AS total FROM confsys.competition_scores WHERE assignment_id=ANY($1::uuid[])",
        [[oldAssignment.id, freshAssignment.id]],
      )
    ).rows[0].total,
  ).toBe(2);
  // Advance the synthetic registration clock after replacement; production rubric
  // rows remain immutable once judging begins.
  await f.admin.query(
    "UPDATE confsys.competition_rubrics SET document=jsonb_set(document,'{registrationClosesAt}',to_jsonb($2::text)) WHERE competition_id=$1",
    [c, new Date(Date.now() - 1000).toISOString()],
  );
  await svc.awards(
    leader.raw,
    {
      competitionId: c,
      expectedVersion: (await current(c)).version,
      awards: [{ entryId: successor.id, label: "Replacement winner", rank: 1 }],
      reason: "Fresh independent score",
    },
    id(),
  );
  const published = await svc.publish(
    leader.raw,
    { competitionId: c, expectedVersion: (await current(c)).version },
    id(),
  );
  expect(JSON.stringify(published)).toContain("Replacement presenter");
  expect(JSON.stringify(published)).not.toContain("Original presenter");
  await withIdentityTransaction(f.app, async (db) => {
    expect(
      (await db.query("SELECT * FROM confsys.competition_presenter_successors"))
        .rows,
    ).toEqual([]);
    expect(
      (await db.query("SELECT * FROM confsys.competition_entry_current")).rows,
    ).toEqual([]);
  });
});

it("isolates competition drafts and rubric/publication history while preserving scoped catalog and version advancement", async () => {
  const c = await competition(),
    p = await paper(),
    e = await approve(await enroll(c, p));
  const a = await assignment(e.id);
  const hidden = id(),
    activePublication = id();
  await f.admin.query(
    "UPDATE confsys.competitions SET award_reason='Private adjudication rationale' WHERE id=$1",
    [c],
  );
  for (const [publicationId, version, name] of [
    [hidden, 100, "Historical award"],
    [activePublication, 101, "Active award"],
  ] as const)
    await f.admin.query(
      "INSERT INTO confsys.competition_publications(id,competition_id,source_version,document,published_by) VALUES($1,$2,$3,$4,$5)",
      [
        publicationId,
        c,
        version,
        { name, tiePolicy: "shared", awards: [] },
        leader.id,
      ],
    );
  await f.admin.query(
    "UPDATE confsys.competitions SET active_publication_id=$2 WHERE id=$1",
    [c, activePublication],
  );
  for (const actor of [null, author.id, judge.id, otherJudge.id])
    await withIdentityTransaction(f.app, async (db) => {
      if (actor)
        await db.query("SELECT set_config('app.actor_id',$1,true)", [actor]);
      for (const table of [
        "competitions",
        "competition_rubrics",
        "competition_publications",
      ])
        expect(
          (
            await db.query(
              `SELECT * FROM confsys.${table} WHERE ${table === "competitions" ? "id" : "competition_id"}=$1`,
              [c],
            )
          ).rows,
        ).toEqual([]);
      const catalog = (
        await db.query(
          "SELECT * FROM confsys.competition_catalog WHERE id=$1",
          [c],
        )
      ).rows;
      expect(catalog).toHaveLength(actor ? 1 : 0);
      expect(JSON.stringify(catalog)).not.toMatch(
        /award_reason|Private adjudication|created_by/,
      );
      expect(
        (
          await db.query(
            "SELECT * FROM confsys.competition_assignment_rubrics WHERE id=$1",
            [a.rubricId],
          )
        ).rowCount,
      ).toBe(actor === judge.id ? 1 : 0);
      expect(
        (
          await db.query(
            "SELECT publication_id FROM confsys.competition_active_awards WHERE id=$1",
            [c],
          )
        ).rows,
      ).toEqual([{ publication_id: activePublication }]);
    });
  expect((await svc.public()).competitions.find((v) => v.id === c)?.name).toBe(
    "Active award",
  );
  expect(
    (await svc.admin(leader.raw, c)).awardDrafts.find(
      (v) => v.competitionId === c,
    )?.reason,
  ).toBe("Private adjudication rationale");
  await expect(
    f.app.query("SELECT confsys.advance_competition_version($1,$2,$3)", [
      c,
      e.id,
      a.id,
    ]),
  ).rejects.toMatchObject({ code: "42501" });
  for (const params of [
    [c, e.id, a.id],
    [c, id(), null],
    [id(), e.id, null],
  ])
    await expect(
      withIdentityTransaction(f.app, async (db) => {
        await db.query("SELECT set_config('app.actor_id',$1,true)", [
          author.id,
        ]);
        await db.query(
          "SELECT confsys.advance_competition_version($1,$2,$3)",
          params,
        );
      }),
    ).rejects.toMatchObject({ code: "42501" });
  const before = (await current(c)).version;
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [judge.id]);
    await db.query("SELECT confsys.advance_competition_version($1,$2,$3)", [
      c,
      e.id,
      a.id,
    ]);
  });
  expect((await current(c)).version).toBe(before + 1);
});

it("extends pending competition assignments without replacing the pinned rubric or allowing stale writes", async () => {
  const compId = await competition(),
    p = await paper(),
    e = await enroll(compId, p);
  await approve(e);
  let a = await assignment(e.id);
  const original = new Date(Date.now() - 60000).toISOString();
  await f.admin.query(
    "UPDATE confsys.competition_rubrics SET document=jsonb_set(document,'{judgingClosesAt}',to_jsonb($2::text)) WHERE id=$1",
    [a.rubricId, original],
  );
  await expect(submit(a)).rejects.toMatchObject({ code: "CONFLICT" });
  const input = {
    id: id(),
    assignmentId: a.id,
    expectedVersion: a.version,
    deadline: new Date(Date.now() + 7200000).toISOString(),
    reason: "Synthetic deadline extension",
  };
  await expect(
    svc.extendDeadline(judge.raw, input, id()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const extended = await svc.extendDeadline(leader.raw, input, id());
  expect(extended.config.judgingClosesAt).toBe(original);
  expect(extended.effectiveDeadline).toBe(input.deadline);
  expect(extended.deadlineHistory).toHaveLength(1);
  expect(await svc.extendDeadline(leader.raw, input, id())).toEqual(extended);
  await expect(
    svc.extendDeadline(leader.raw, { ...input, id: id() }, id()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const raced = await Promise.allSettled(
    [0, 1].map(() =>
      svc.extendDeadline(
        leader.raw,
        {
          ...input,
          id: id(),
          expectedVersion: extended.version,
          deadline: new Date(Date.now() + 10800000).toISOString(),
        },
        id(),
      ),
    ),
  );
  expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  a = (await svc.judging(judge.raw)).assignments.find((x) => x.id === a.id)!;
  expect(a.deadlineHistory).toHaveLength(2);
  await svc.remind(
    leader.raw,
    {
      assignmentId: a.id,
      idempotencyKey: id(),
      reason: "Extended pending deadline",
    },
    id(),
  );
  await submit(a);
  await expect(
    svc.extendDeadline(
      leader.raw,
      {
        ...input,
        id: id(),
        expectedVersion: a.version + 1,
        deadline: new Date(Date.now() + 14400000).toISOString(),
      },
      id(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [
      otherJudge.id,
    ]);
    expect(
      (
        await db.query(
          "SELECT id FROM confsys.competition_deadline_extensions WHERE assignment_id=$1",
          [a.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  await expect(
    withIdentityTransaction(f.app, (db) =>
      db.query(
        "UPDATE confsys.competition_deadline_extensions SET reason='rewrite' WHERE false",
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    withIdentityTransaction(f.app, async (db) => {
      await db.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.competitions_manage','true',true)",
        [leader.id],
      );
      return db.query(
        "INSERT INTO confsys.competition_deadline_extensions(id,assignment_id,assignment_version,previous_deadline,deadline,reason,created_by) VALUES($1,$2,$3,$4,$5,'Forged basis',$6)",
        [
          id(),
          a.id,
          a.version + 2,
          original,
          new Date(Date.now() + 14400000),
          leader.id,
        ],
      );
    }),
  ).rejects.toMatchObject({ code: "23514" });
});

import { beforeAll, beforeEach, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createAccessService } from "../../apps/api/src/access/service.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { createSubmissionService } from "../../apps/api/src/submissions/service.js";
import { submissionDependencies } from "../../apps/api/src/submissions/dependencies.js";
import { withIdentityTransaction } from "@confsys/db";
import { type SubmissionDocument } from "@confsys/contracts";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  access = createAccessService(f.app, f.config),
  service = createSubmissionService(f.app, f.config, submissionDependencies),
  rid = () => randomUUID();
async function account() {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const login = await auth.login(email, password, rid());
  return { id: login.account.user.id, email, raw: login.raw };
}
let leader: Awaited<ReturnType<typeof account>>,
  author: Awaited<ReturnType<typeof account>>,
  stranger: Awaited<ReturnType<typeof account>>,
  staff: Awaited<ReturnType<typeof account>>,
  baseline: Record<string, unknown>;
const doc = (): SubmissionDocument => ({
  title: "Synthetic title",
  abstract: "Synthetic abstract",
  keywords: [],
  correspondingAuthorIndex: 0,
  trackId: "science",
  topicIds: ["physics"],
  authors: [
    {
      name: "Synthetic author",
      email: "unregistered@example.invalid",
      affiliation: "Synthetic institute",
    },
  ],
  presenterIndex: 0,
  presentationPreference: "either",
  competition: true,
  attachmentIds: [],
  slidesFileId: null,
  videoUrl: "https://example.invalid/video",
});
async function configure(patch: object = {}) {
  const config = await service.config(leader.raw);
  return service.configure(leader.raw, { ...config, ...patch }, rid());
}
async function draft(document = doc()) {
  return service.save(
    author.raw,
    { id: rid(), expectedVersion: 0, document },
    rid(),
  );
}
beforeAll(async () => {
  f.migrate();
  baseline = (await f.admin.query("SELECT * FROM confsys.submission_config"))
    .rows[0];
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
      reason: "Synthetic submissions",
      confirmOrigin: f.config.PUBLIC_APP_ORIGIN,
    },
    rid(),
  );
  leader.raw = (await auth.login(leader.email, password, rid())).raw;
  author = await account();
  stranger = await account();
  staff = await account();
  await access.mutate(
    leader.raw,
    staff.id,
    { action: "grant", role: "conference_staff", reason: "Synthetic staff" },
    rid(),
  );
  staff.raw = (await auth.login(staff.email, password, rid())).raw;
  await configure({
    opensAt: new Date(Date.now() - 60000).toISOString(),
    closesAt: new Date(Date.now() + 3600000).toISOString(),
    tracks: [
      {
        id: "science",
        name: "Science",
        topics: [{ id: "physics", name: "Physics" }],
      },
    ],
  });
});
beforeEach(async () => {
  await configure({
    requireRegistration: false,
    requireAttachment: false,
    mode: "abstract",
    presenterMustBeSubmitter: false,
    opensAt: new Date(Date.now() - 60000).toISOString(),
    closesAt: new Date(Date.now() + 3600000).toISOString(),
  });
});
afterAll(async () => {
  if (baseline)
    await f.admin.query(
      "UPDATE confsys.submission_config SET version=$1,document=$2",
      [baseline.version, baseline.document],
    );
  const ids = [leader?.id, author?.id, stranger?.id, staff?.id].filter(Boolean);
  await f.admin.query(
    "DELETE FROM confsys.file_references WHERE file_id IN(SELECT id FROM confsys.file_assets WHERE owner_id=ANY($1::uuid[]))",
    [ids],
  );
  await f.admin.query(
    "UPDATE confsys.submissions SET current_revision_id=null,submitted_version=null,state='draft' WHERE owner_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.submission_revisions WHERE owner_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.submissions WHERE owner_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.file_assets WHERE owner_id=ANY($1::uuid[])",
    [ids],
  );
  await f.cleanup();
});
it("owner-only drafts, ordered unregistered coauthors and explicit admin read permission", async () => {
  const paper = await draft();
  expect(paper.state).toBe("draft");
  expect(paper.currentRevisionId).toBeNull();
  expect(
    (await service.detail(author.raw, paper.id, "own")).submission.document
      .authors[0]!.email,
  ).toBe("unregistered@example.invalid");
  for (const raw of [stranger.raw, staff.raw]) {
    await expect(service.detail(raw, paper.id, "own")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(service.detail(raw, paper.id, "admin")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      service.save(
        raw,
        { id: paper.id, expectedVersion: paper.version, document: doc() },
        rid(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  }
  await expect(service.list(undefined, "own", 0)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  expect(
    (await service.detail(leader.raw, paper.id, "admin")).submission.id,
  ).toBe(paper.id);
  expect((await service.list(stranger.raw, "own", 0)).items).toHaveLength(0);
  expect(
    (
      await f.admin.query(
        "SELECT id FROM confsys.users WHERE email='unregistered@example.invalid'",
      )
    ).rowCount,
  ).toBe(0);
});
it("concurrent saves conflict; submit retries produce one immutable revision and business notification", async () => {
  const paper = await draft();
  const races = await Promise.allSettled([
    service.save(
      author.raw,
      { id: paper.id, expectedVersion: 1, document: { ...doc(), title: "A" } },
      rid(),
    ),
    service.save(
      author.raw,
      { id: paper.id, expectedVersion: 1, document: { ...doc(), title: "B" } },
      rid(),
    ),
  ]);
  expect(races.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(races.find((r) => r.status === "rejected")).toMatchObject({
    reason: { code: "CONFLICT" },
  });
  const results = await Promise.all([
    service.transition(
      author.raw,
      { id: paper.id, expectedVersion: 2, action: "submit" },
      rid(),
    ),
    service.transition(
      author.raw,
      { id: paper.id, expectedVersion: 2, action: "submit" },
      rid(),
    ),
  ]);
  expect(results[0]).toEqual(results[1]);
  const historical = await service.detail(author.raw, paper.id, "own");
  expect(historical.revisions).toHaveLength(1);
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM confsys.notifications WHERE event_key=$1",
        [`submission:${paper.id}:submit:2`],
      )
    ).rows[0].count,
  ).toBe("1");
  const revision = historical.revisions[0]!;
  const updated = await service.save(
    author.raw,
    {
      id: paper.id,
      expectedVersion: 2,
      document: { ...doc(), title: "Revised title" },
    },
    rid(),
  );
  expect(updated.state).toBe("submitted");
  expect(updated.submittedVersion).toBe(2);
  expect(
    (await service.detail(author.raw, paper.id, "own")).revisions[0],
  ).toEqual(revision);
  await service.transition(
    author.raw,
    { id: paper.id, expectedVersion: 3, action: "submit" },
    rid(),
  );
  expect(
    (await service.detail(author.raw, paper.id, "own")).revisions,
  ).toHaveLength(2);
  const snapshot = (
    await f.admin.query(
      "SELECT config_snapshot FROM confsys.submission_revisions WHERE id=$1",
      [revision.id],
    )
  ).rows[0].config_snapshot;
  expect(snapshot.tracks[0].name).toBe("Science");
  for (const db of [f.app, f.worker])
    for (const sql of [
      "UPDATE confsys.submission_revisions SET document=document WHERE false",
      "DELETE FROM confsys.submission_revisions WHERE false",
    ])
      await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
});
it("registration gating, server deadlines and withdrawal are separate from review decisions", async () => {
  const paper = await draft();
  await configure({ requireRegistration: true });
  await expect(
    service.transition(
      author.raw,
      { id: paper.id, expectedVersion: 1, action: "submit" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await configure({
    requireRegistration: false,
    closesAt: new Date(Date.now() - 1000).toISOString(),
  });
  await expect(
    service.transition(
      author.raw,
      { id: paper.id, expectedVersion: 1, action: "submit" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(draft()).rejects.toMatchObject({ code: "CONFLICT" });
  const withdrawn = await service.transition(
    author.raw,
    { id: paper.id, expectedVersion: 1, action: "withdraw" },
    rid(),
  );
  expect(withdrawn.state).toBe("withdrawn");
  expect(withdrawn.currentRevisionId).toBeNull();
  await configure({ closesAt: new Date(Date.now() + 3600000).toISOString() });
  await expect(
    service.save(
      author.raw,
      { id: paper.id, expectedVersion: withdrawn.version, document: doc() },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    service.transition(
      author.raw,
      { id: paper.id, expectedVersion: withdrawn.version, action: "submit" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("files must be ready, owned manuscript assets; submission snapshot references cannot be omitted", async () => {
  const owned = rid(),
    other = rid(),
    quarantined = rid();
  for (const [id, owner, state] of [
    [owned, author.id, "ready"],
    [other, stranger.id, "ready"],
    [quarantined, author.id, "quarantined"],
  ])
    await f.admin.query(
      "INSERT INTO confsys.file_assets(id,owner_id,purpose,original_name,media_type,size_bytes,sha256,storage_key,status) VALUES($1,$2,'manuscript','synthetic.pdf','application/pdf',100,$3,$4,$5)",
      [id, owner, "a".repeat(64), rid(), state],
    );
  await expect(
    draft({ ...doc(), attachmentIds: [other] }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    draft({ ...doc(), attachmentIds: [quarantined] }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const paper = await draft({ ...doc(), attachmentIds: [owned] });
  await service.transition(
    author.raw,
    { id: paper.id, expectedVersion: 1, action: "submit" },
    rid(),
  );
  const refs = await f.admin.query(
    "SELECT resource_id FROM confsys.file_references WHERE file_id=$1 AND resource_type='submission_revision'",
    [owned],
  );
  expect(refs.rowCount).toBe(1);
});
it("missing/foreign RLS contexts deny and transaction-local context never leaks to pooled connections", async () => {
  const paper = await draft();
  expect(
    (await f.app.query("SELECT id FROM confsys.submissions")).rowCount,
  ).toBe(0);
  expect(
    (await f.app.query("SELECT id FROM confsys.submission_revisions")).rowCount,
  ).toBe(0);
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [stranger.id]);
    expect(
      (
        await db.query("SELECT id FROM confsys.submissions WHERE id=$1", [
          paper.id,
        ])
      ).rowCount,
    ).toBe(0);
    await expect(
      db.query(
        "INSERT INTO confsys.submissions(id,owner_id,version,document) VALUES($1,$2,1,$3)",
        [rid(), author.id, doc()],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  expect(
    (await f.app.query("SELECT id FROM confsys.submissions")).rowCount,
  ).toBe(0);
});
it("outbox failure rolls back revision and state instead of reporting successful submission", async () => {
  const paper = await draft(),
    failure = rid();
  await f.admin.query(
    `CREATE FUNCTION confsys.submissions_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${failure}'::uuid THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$`,
  );
  await f.admin.query(
    "CREATE TRIGGER submissions_test_failure BEFORE INSERT ON confsys.notifications FOR EACH ROW EXECUTE FUNCTION confsys.submissions_test_failure()",
  );
  try {
    await expect(
      service.transition(
        author.raw,
        { id: paper.id, expectedVersion: 1, action: "submit" },
        failure,
      ),
    ).rejects.toThrow();
    const after = await service.detail(author.raw, paper.id, "own");
    expect(after.submission).toEqual(paper);
    expect(after.revisions).toHaveLength(0);
  } finally {
    await f.admin.query(
      "DROP TRIGGER submissions_test_failure ON confsys.notifications",
    );
    await f.admin.query("DROP FUNCTION confsys.submissions_test_failure()");
  }
});

it("HTTP enforces CSRF, strict payloads and no-store private responses", async () => {
  const { buildApp } = await import("../../apps/api/src/app.js");
  const { registerAuthRoutes } =
    await import("../../apps/api/src/auth/routes.js");
  const { registerSubmissionRoutes } =
    await import("../../apps/api/src/submissions/routes.js");
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
      `submission-${rid()}`,
    ),
  });
  registerSubmissionRoutes(server, f.config, service);
  const host = new URL(f.config.PUBLIC_APP_ORIGIN).host;
  try {
    const csrf = await server.inject({
      url: "/api/auth/csrf",
      headers: { host },
    });
    const cookies = csrf.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const headers = {
      host,
      cookie: `dev-session=${author.raw}; ${cookies}`,
      origin: f.config.PUBLIC_APP_ORIGIN,
      "x-csrf-token": csrf.json().csrfToken,
    };
    const payload = { id: rid(), expectedVersion: 0, document: doc() };
    for (const extra of [
      { origin: "http://evil.invalid" },
      { "x-csrf-token": "" },
    ])
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/submissions/save",
            headers: { ...headers, ...extra },
            payload,
          })
        ).statusCode,
      ).toBe(403);
    for (const extra of [
      { ownerId: stranger.id },
      { state: "submitted" },
      { currentRevisionId: rid() },
    ])
      expect(
        (
          await server.inject({
            method: "POST",
            url: "/api/submissions/save",
            headers,
            payload: { ...payload, ...extra },
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await server.inject({
          url: "/api/submissions/detail?id=not-a-uuid",
          headers,
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await server.inject({ url: "/api/submissions?scope=admin", headers }))
        .statusCode,
    ).toBe(403);
    const created = await server.inject({
      method: "POST",
      url: "/api/submissions/save",
      headers,
      payload,
    });
    expect(created.statusCode).toBe(200);
    expect(created.headers["cache-control"]).toBe("no-store");
    expect(created.headers["x-robots-tag"]).toContain("noindex");
    expect(Object.keys(created.json()).sort()).toEqual(
      [
        "id",
        "ownerId",
        "number",
        "state",
        "version",
        "submittedVersion",
        "currentRevisionId",
        "document",
        "updatedAt",
      ].sort(),
    );
    const foreign = await server.inject({
      url: `/api/submissions/detail?id=${payload.id}`,
      headers: { host, cookie: `dev-session=${stranger.raw}` },
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.body).not.toContain(payload.document.title);
  } finally {
    await server.close();
    redis.disconnect();
  }
});

it("a queued author mutation revalidates session after a concurrent revocation", async () => {
  const paper = await draft();
  const blocker = await f.admin.connect();
  await blocker.query("BEGIN");
  await blocker.query(
    "SELECT singleton FROM confsys.access_control FOR UPDATE",
  );
  const revoke = access.mutate(
    leader.raw,
    author.id,
    { action: "revoke_sessions", reason: "Synthetic queued submission race" },
    rid(),
  );
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
    const submitting = service.transition(
      author.raw,
      { id: paper.id, expectedVersion: paper.version, action: "submit" },
      rid(),
    );
    const rejected = expect(submitting).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    await blocker.query("COMMIT");
    await revoke;
    await rejected;
  } finally {
    await blocker.query("ROLLBACK");
    blocker.release();
    await Promise.allSettled([revoke]);
  }
  expect(
    (
      await f.admin.query("SELECT state FROM confsys.submissions WHERE id=$1", [
        paper.id,
      ])
    ).rows[0].state,
  ).toBe("draft");
  author.raw = (await auth.login(author.email, password, rid())).raw;
});

it("reviewer RLS grants never grant primary author detail, draft editing or withdrawal", async () => {
  const paper = await draft();
  const submitted = await service.transition(
    author.raw,
    { id: paper.id, expectedVersion: 1, action: "submit" },
    rid(),
  );
  const formId = rid(),
    assignmentId = rid();
  await f.admin.query(
    "INSERT INTO confsys.review_forms(id,version,document,created_by) VALUES($1,1,$2,$3)",
    [formId, { blindMode: "double", criteria: [] }, leader.id],
  );
  await f.admin.query(
    "INSERT INTO confsys.review_assignments(id,submission_id,revision_id,reviewer_id,form_id,state,created_by) VALUES($1,$2,$3,$4,$5,'accepted',$6)",
    [
      assignmentId,
      paper.id,
      submitted.currentRevisionId,
      stranger.id,
      formId,
      leader.id,
    ],
  );
  try {
    // Demonstrate this actor can see the row through reviewer RLS, then assert service ownership still denies.
    await withIdentityTransaction(f.app, async (db) => {
      await db.query("SELECT set_config('app.actor_id',$1,true)", [
        stranger.id,
      ]);
      expect(
        (
          await db.query("SELECT id FROM confsys.submissions WHERE id=$1", [
            paper.id,
          ])
        ).rowCount,
      ).toBe(1);
    });
    await expect(
      service.detail(stranger.raw, paper.id, "own"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.save(
        stranger.raw,
        { id: paper.id, expectedVersion: 1, document: doc() },
        rid(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      service.transition(
        stranger.raw,
        { id: paper.id, expectedVersion: 1, action: "withdraw" },
        rid(),
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    await f.admin.query("DELETE FROM confsys.review_assignments WHERE id=$1", [
      assignmentId,
    ]);
    await f.admin.query("DELETE FROM confsys.review_forms WHERE id=$1", [
      formId,
    ]);
  }
});

it("only a current published revision request extends a closed window and it is fulfilled atomically", async () => {
  const paper = await draft(),
    submitted = await service.transition(
      author.raw,
      { id: paper.id, expectedVersion: 1, action: "submit" },
      rid(),
    ),
    decisionId = rid(),
    requestId = rid();
  const deadline = new Date(Date.now() + 60000).toISOString();
  await f.admin.query(
    "INSERT INTO confsys.review_decisions(id,submission_id,revision_id,version,outcome,author_message,internal_reason,revision_deadline,decided_by) VALUES($1,$2,$3,1,'revision_requested','Synthetic revision','Synthetic decision',$4,$5)",
    [decisionId, paper.id, submitted.currentRevisionId, deadline, leader.id],
  );
  await f.admin.query(
    "INSERT INTO confsys.submission_revision_requests(id,submission_id,revision_id,decision_id,deadline) VALUES($1,$2,$3,$4,$5)",
    [requestId, paper.id, submitted.currentRevisionId, decisionId, deadline],
  );
  try {
    await configure({ closesAt: new Date(Date.now() - 1000).toISOString() });
    await expect(
      service.save(
        author.raw,
        {
          id: paper.id,
          expectedVersion: 1,
          document: { ...doc(), title: "Not published" },
        },
        rid(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await f.admin.query(
      "INSERT INTO confsys.review_publications(submission_id,decision_id,published_by) VALUES($1,$2,$3)",
      [paper.id, decisionId, leader.id],
    );
    const revised = await service.save(
      author.raw,
      {
        id: paper.id,
        expectedVersion: 1,
        document: { ...doc(), title: "Requested revision" },
      },
      rid(),
    );
    const next = await service.transition(
      author.raw,
      { id: paper.id, expectedVersion: revised.version, action: "submit" },
      rid(),
    );
    expect(next.currentRevisionId).not.toBe(submitted.currentRevisionId);
    expect(
      (
        await f.admin.query(
          "SELECT new_revision_id FROM confsys.submission_revision_requests WHERE id=$1",
          [requestId],
        )
      ).rows[0].new_revision_id,
    ).toBe(next.currentRevisionId);
    await expect(
      service.save(
        author.raw,
        { id: paper.id, expectedVersion: next.version, document: doc() },
        rid(),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  } finally {
    await f.admin.query(
      "DELETE FROM confsys.submission_revision_requests WHERE id=$1",
      [requestId],
    );
    await f.admin.query(
      "DELETE FROM confsys.review_publications WHERE submission_id=$1",
      [paper.id],
    );
    await f.admin.query("DELETE FROM confsys.review_decisions WHERE id=$1", [
      decisionId,
    ]);
  }
});

it("configurable presenter identity and full-paper/slide PDF rules are enforced on server", async () => {
  await configure({ presenterMustBeSubmitter: true });
  const foreign = await draft();
  await expect(
    service.transition(
      author.raw,
      { id: foreign.id, expectedVersion: foreign.version, action: "submit" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const ownDoc = {
    ...doc(),
    authors: [
      {
        name: "Verified presenter",
        email: author.email,
        affiliation: "Synthetic institute",
      },
    ],
  };
  const own = await draft(ownDoc);
  await service.transition(
    author.raw,
    { id: own.id, expectedVersion: own.version, action: "submit" },
    rid(),
  );
  const image = rid(),
    pdf = rid();
  for (const [fileId, mime] of [
    [image, "image/png"],
    [pdf, "application/pdf"],
  ])
    await f.admin.query(
      "INSERT INTO confsys.file_assets(id,owner_id,purpose,original_name,media_type,size_bytes,sha256,storage_key,status) VALUES($1,$2,'manuscript','Synthetic fixture',$3,12,$4,$5,'ready')",
      [fileId, author.id, mime, "0".repeat(64), rid()],
    );
  await expect(draft({ ...ownDoc, slidesFileId: image })).rejects.toMatchObject(
    { code: "INVALID_REQUEST" },
  );
  await configure({ mode: "full_paper" });
  const incomplete = await draft({ ...ownDoc, attachmentIds: [image] });
  await expect(
    service.transition(
      author.raw,
      {
        id: incomplete.id,
        expectedVersion: incomplete.version,
        action: "submit",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  const complete = await draft({
    ...ownDoc,
    attachmentIds: [pdf],
    slidesFileId: null,
  });
  await service.transition(
    author.raw,
    { id: complete.id, expectedVersion: complete.version, action: "submit" },
    rid(),
  );
  expect(
    (
      await f.admin.query(
        "SELECT config_snapshot FROM confsys.submission_revisions WHERE submission_id=$1",
        [complete.id],
      )
    ).rows[0].config_snapshot,
  ).toMatchObject({ mode: "full_paper", presenterMustBeSubmitter: true });
});

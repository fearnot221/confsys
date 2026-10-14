import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { withIdentityTransaction } from "@confsys/db";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { createSubmissionService } from "../../apps/api/src/submissions/service.js";
import { submissionDependencies } from "../../apps/api/src/submissions/dependencies.js";
import { createPresenterChangesService } from "../../apps/api/src/presenter-changes/service.js";
import { publishedAcceptedRevision } from "../../apps/api/src/submissions/repository.js";
import type { SubmissionDocument } from "@confsys/contracts";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  submissions = createSubmissionService(
    f.app,
    f.config,
    submissionDependencies,
  ),
  service = createPresenterChangesService(
    f.app,
    f.config,
    submissionDependencies,
  ),
  rid = () => randomUUID();
async function account() {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const l = await auth.login(email, password, rid());
  return { id: l.account.user.id, email, raw: l.raw };
}
let owner: Awaited<ReturnType<typeof account>>,
  target: Awaited<ReturnType<typeof account>>,
  admin: Awaited<ReturnType<typeof account>>,
  stranger: Awaited<ReturnType<typeof account>>,
  baseline: Record<string, unknown>;
const documents: string[] = [];
const fileId = rid();
const doc = (): SubmissionDocument => ({
  title: "Synthetic presenter replacement",
  abstract: "Synthetic abstract",
  keywords: [],
  correspondingAuthorIndex: 0,
  trackId: "science",
  topicIds: [],
  authors: [
    { name: "原報告者", email: owner.email, affiliation: "合成研究所" },
    { name: "新報告者", email: target.email, affiliation: "合成大學" },
  ],
  presenterIndex: 0,
  presentationPreference: "either",
  competition: true,
  attachmentIds: [fileId],
  slidesFileId: null,
  videoUrl: "",
});
async function paper() {
  const d = await submissions.save(
    owner.raw,
    { id: rid(), expectedVersion: 0, document: doc() },
    rid(),
  );
  documents.push(d.id);
  return submissions.transition(
    owner.raw,
    { id: d.id, expectedVersion: d.version, action: "submit" },
    rid(),
  );
}
async function request() {
  const p = await paper();
  return service.create(
    owner.raw,
    {
      id: rid(),
      submissionId: p.id,
      sourceRevisionId: p.currentRevisionId,
      expectedSubmissionVersion: p.version,
      targetAuthorIndex: 1,
      reason: "需要改由共同作者報告",
    },
    rid(),
  );
}
async function accept() {
  const r = await request();
  return service.respond(
    target.raw,
    {
      id: r.id,
      expectedVersion: r.version,
      action: "accept",
      reason: "本人同意接任報告者",
    },
    rid(),
  );
}
beforeAll(async () => {
  f.migrate();
  baseline = (await f.admin.query("SELECT * FROM confsys.submission_config"))
    .rows[0];
  owner = await account();
  target = await account();
  stranger = await account();
  await f.admin.query(
    "INSERT INTO confsys.file_assets(id,owner_id,purpose,original_name,media_type,size_bytes,sha256,storage_key,status) VALUES($1,$2,'manuscript','synthetic.pdf','application/pdf',100,$3,$4,'ready')",
    [fileId, owner.id, "0".repeat(64), rid()],
  );
  admin = await account();
  await bootstrapAdministrator(
    f.admin,
    {
      conferenceName: f.config.CONFERENCE_NAME,
      origin: f.config.PUBLIC_APP_ORIGIN,
    },
    {
      targetId: admin.id,
      apply: true,
      reason: "Synthetic presenter bootstrap",
      confirmOrigin: f.config.PUBLIC_APP_ORIGIN,
    },
    rid(),
  );
  admin.raw = (await auth.login(admin.email, password, rid())).raw;
  const c = await submissions.config(admin.raw);
  await submissions.configure(
    admin.raw,
    {
      ...c,
      opensAt: new Date(Date.now() - 60000).toISOString(),
      closesAt: new Date(Date.now() + 3600000).toISOString(),
      tracks: [{ id: "science", name: "Science", topics: [] }],
      requireRegistration: false,
      requireAttachment: false,
      mode: "abstract",
      presenterMustBeSubmitter: false,
      acceptedRegistrationDeadline: null,
    },
    rid(),
  );
});
afterAll(async () => {
  const ids = [owner?.id, target?.id, admin?.id, stranger?.id].filter(Boolean);
  await f.admin.query(
    "DELETE FROM confsys.presenter_change_requests WHERE requester_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.review_publications WHERE submission_id=ANY($1::uuid[])",
    [documents],
  );
  await f.admin.query(
    "DELETE FROM confsys.review_decisions WHERE submission_id=ANY($1::uuid[])",
    [documents],
  );
  await f.admin.query(
    "UPDATE confsys.submissions SET current_revision_id=null,submitted_version=null,state='draft' WHERE owner_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.file_references WHERE resource_id IN(SELECT id FROM confsys.submission_revisions WHERE owner_id=ANY($1::uuid[]))",
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
  if (baseline)
    await f.admin.query(
      "UPDATE confsys.submission_config SET version=$1,document=$2",
      [baseline.version, baseline.document],
    );
  await f.admin.query("DELETE FROM confsys.file_assets WHERE id=$1", [fileId]);
  await f.cleanup();
});
it("requires target consent, scopes private projection and preserves immutable revision with administrative audit", async () => {
  const row = await request();
  await expect(
    service.decide(
      admin.raw,
      {
        id: row.id,
        expectedVersion: row.version,
        action: "approve",
        reason: "Approved before consent",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    service.respond(
      stranger.raw,
      {
        id: row.id,
        expectedVersion: row.version,
        action: "accept",
        reason: "Unauthorized consent",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await service.list(stranger.raw, "incoming", 0)).items).toEqual([]);
  const incoming = (await service.list(target.raw, "incoming", 0)).items.find(
    (r) => r.id === row.id,
  )!;
  expect(incoming).not.toHaveProperty("document");
  await expect(
    submissions.detail(target.raw, row.submissionId, "own"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const input = {
    id: row.id,
    expectedVersion: row.version,
    action: "accept",
    reason: "本人同意接任",
  };
  const [a, b] = await Promise.all([
    service.respond(target.raw, input, rid()),
    service.respond(target.raw, input, rid()),
  ]);
  expect(a).toEqual(b);
  const approve = {
    id: a.id,
    expectedVersion: a.version,
    action: "approve",
    reason: "核對本人同意並核准",
  };
  const [approved, retry] = await Promise.all([
    service.decide(admin.raw, approve, rid()),
    service.decide(admin.raw, approve, rid()),
  ]);
  expect(approved).toEqual(retry);
  expect(approved.state).toBe("approved");
  const detail = await submissions.detail(owner.raw, row.submissionId, "own");
  expect(detail.submission.ownerId).toBe(owner.id);
  expect(detail.submission.document.presenterIndex).toBe(1);
  expect(detail.revisions).toHaveLength(2);
  expect(detail.revisions[1]?.document.presenterIndex).toBe(0);
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int AS count FROM confsys.file_references WHERE file_id=$1 AND resource_type='submission_revision' AND resource_id IN(SELECT id FROM confsys.submission_revisions WHERE submission_id=$2)",
        [fileId, row.submissionId],
      )
    ).rows[0].count,
  ).toBe(2);
  const audit = (
    await f.admin.query(
      "SELECT actor_id FROM confsys.auth_audit WHERE event='presenter_change.approved' AND after_value::jsonb->>'resourceId'=$1",
      [row.id],
    )
  ).rows;
  expect(audit).toEqual([{ actor_id: admin.id }]);
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [target.id]);
    expect(
      (
        await db.query(
          "SELECT id FROM confsys.submission_revisions WHERE submission_id=$1",
          [row.submissionId],
        )
      ).rows,
    ).toEqual([]);
  });
});
it("blocks ordinary save and submit presenter replacement, allows same-person author reordering", async () => {
  const p = await paper();
  await expect(
    submissions.save(
      owner.raw,
      {
        id: p.id,
        expectedVersion: p.version,
        document: { ...p.document, presenterIndex: 1 },
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await f.admin.query(
    "UPDATE confsys.submissions SET document=jsonb_set(document,'{presenterIndex}','1'),version=version+1 WHERE id=$1",
    [p.id],
  );
  await expect(
    submissions.transition(
      owner.raw,
      { id: p.id, expectedVersion: p.version + 1, action: "submit" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const reordered = {
    ...p.document,
    authors: [p.document.authors[1]!, p.document.authors[0]!],
    presenterIndex: 1,
    correspondingAuthorIndex: 1,
  };
  await expect(
    submissions.save(
      owner.raw,
      { id: p.id, expectedVersion: p.version + 1, document: reordered },
      rid(),
    ),
  ).resolves.toMatchObject({ document: { presenterIndex: 1 } });
});
it("rejects stale draft, changed credentials and non-admin decisions", async () => {
  const row = await accept();
  await expect(
    service.decide(
      owner.raw,
      {
        id: row.id,
        expectedVersion: row.version,
        action: "approve",
        reason: "Not administrator",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await f.admin.query(
    "UPDATE confsys.users SET credential_version=credential_version+1 WHERE id=$1",
    [target.id],
  );
  await expect(
    service.decide(
      admin.raw,
      {
        id: row.id,
        expectedVersion: row.version,
        action: "approve",
        reason: "Stale consent credential",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  target.raw = (await auth.login(target.email, password, rid())).raw;
  const stale = await accept(),
    p = (await submissions.detail(owner.raw, stale.submissionId, "own"))
      .submission;
  await submissions.save(
    owner.raw,
    {
      id: p.id,
      expectedVersion: p.version,
      document: { ...p.document, title: "Updated pending draft" },
    },
    rid(),
  );
  await expect(
    service.decide(
      admin.raw,
      {
        id: stale.id,
        expectedVersion: stale.version,
        action: "approve",
        reason: "Cannot overwrite draft",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("honors presenter policy and expiration and rolls back revision on notification/audit failure", async () => {
  const row = await accept();
  await expect(
    service.decide(
      admin.raw,
      {
        id: row.id,
        expectedVersion: row.version,
        action: "approve",
        reason: "Synthetic rollback",
      },
      "not-a-uuid",
    ),
  ).rejects.toBeDefined();
  expect(
    (await submissions.detail(owner.raw, row.submissionId, "own")).revisions,
  ).toHaveLength(1);
  expect(
    (await service.list(owner.raw, "own", 0)).items.find((r) => r.id === row.id)
      ?.state,
  ).toBe("accepted");
  await f.admin.query(
    "UPDATE confsys.presenter_change_requests SET expires_at=clock_timestamp()-interval '1 second',created_at=clock_timestamp()-interval '1 day',version=version+1,state='cancelled',decision_actor=$2,decision_reason='Synthetic expired fixture',decided_at=clock_timestamp() WHERE id=$1",
    [row.id, owner.id],
  );
  await expect(
    service.respond(
      target.raw,
      {
        id: row.id,
        expectedVersion: row.version,
        action: "accept",
        reason: "Expired response",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const expiredId = rid();
  await f.admin.query(
    "INSERT INTO confsys.presenter_change_requests(id,submission_id,source_revision_id,expected_submission_version,config_version,requester_id,target_user_id,target_author_index,target_email,projection,reason,created_at,expires_at) SELECT $2,submission_id,source_revision_id,expected_submission_version,config_version,requester_id,target_user_id,target_author_index,target_email,projection,reason,clock_timestamp()-interval '2 days',clock_timestamp()-interval '1 day' FROM confsys.presenter_change_requests WHERE id=$1",
    [row.id, expiredId],
  );
  await expect(
    service.respond(
      target.raw,
      {
        id: expiredId,
        expectedVersion: 1,
        action: "accept",
        reason: "Expired pending consent",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const c = await submissions.config(admin.raw);
  await submissions.configure(
    admin.raw,
    { ...c, presenterMustBeSubmitter: true },
    rid(),
  );
  const p = await paper();
  await expect(
    service.create(
      owner.raw,
      {
        id: rid(),
        submissionId: p.id,
        sourceRevisionId: p.currentRevisionId,
        expectedSubmissionVersion: p.version,
        targetAuthorIndex: 1,
        reason: "Policy disallows replacement",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  await submissions.configure(
    admin.raw,
    {
      ...(await submissions.config(admin.raw)),
      presenterMustBeSubmitter: false,
    },
    rid(),
  );
});
it("invalidates old published acceptance even when approved source was a newer unaccepted revision", async () => {
  const p = await paper(),
    decision = rid();
  await f.admin.query(
    "INSERT INTO confsys.review_decisions(id,submission_id,revision_id,version,outcome,author_message,internal_reason,decided_by) VALUES($1,$2,$3,1,'accept_oral','Synthetic acceptance','Synthetic decision',$4)",
    [decision, p.id, p.currentRevisionId, admin.id],
  );
  await f.admin.query(
    "INSERT INTO confsys.review_publications(submission_id,decision_id,published_by) VALUES($1,$2,$3)",
    [p.id, decision, admin.id],
  );
  const saved = await submissions.save(
      owner.raw,
      {
        id: p.id,
        expectedVersion: p.version,
        document: { ...p.document, title: "Newer source content" },
      },
      rid(),
    ),
    newer = await submissions.transition(
      owner.raw,
      { id: p.id, expectedVersion: saved.version, action: "submit" },
      rid(),
    );
  const row = await service.create(
      owner.raw,
      {
        id: rid(),
        submissionId: p.id,
        sourceRevisionId: newer.currentRevisionId,
        expectedSubmissionVersion: newer.version,
        targetAuthorIndex: 1,
        reason: "Replace presenter on newer revision",
      },
      rid(),
    ),
    consent = await service.respond(
      target.raw,
      {
        id: row.id,
        expectedVersion: row.version,
        action: "accept",
        reason: "I consent to present",
      },
      rid(),
    );
  await service.decide(
    admin.raw,
    {
      id: row.id,
      expectedVersion: consent.version,
      action: "approve",
      reason: "Confirmed replacement",
    },
    rid(),
  );
  await expect(
    withIdentityTransaction(f.app, async (db) => {
      await db.query("SELECT set_config('app.actor_id',$1,true)", [owner.id]);
      return publishedAcceptedRevision(db, p.currentRevisionId!);
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (
      await f.admin.query(
        "SELECT decision_id FROM confsys.review_publications WHERE submission_id=$1",
        [p.id],
      )
    ).rows[0]?.decision_id,
  ).toBe(decision);
});

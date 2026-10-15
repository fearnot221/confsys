import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withIdentityTransaction } from "@confsys/db";
import type { SubmissionDocument, ReviewAssignment } from "@confsys/contracts";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createAccessService } from "../../apps/api/src/access/service.js";
import { createSubmissionService } from "../../apps/api/src/submissions/service.js";
import { submissionDependencies } from "../../apps/api/src/submissions/dependencies.js";
import {
  createReviewService,
  authorizeReviewFile,
} from "../../apps/api/src/reviews/service.js";
import { context } from "../../apps/api/src/reviews/repository.js";
import { createFilesService } from "../../apps/api/src/files/service.js";
import { createReviewFileDownload } from "../../apps/api/src/files/review-download.js";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  access = createAccessService(f.app, f.config),
  submissions = createSubmissionService(
    f.app,
    f.config,
    submissionDependencies,
  ),
  reviews = createReviewService(f.app, f.config),
  rid = () => randomUUID();
async function account(roles: string[] = []) {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const login = await auth.login(email, password, rid());
  for (const role of roles)
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES ($1,$2)",
      [login.account.user.id, role],
    );
  return { id: login.account.user.id, email, raw: login.raw };
}
let admin: Awaited<ReturnType<typeof account>>,
  chair: Awaited<ReturnType<typeof account>>,
  reviewer: Awaited<ReturnType<typeof account>>,
  otherReviewer: Awaited<ReturnType<typeof account>>,
  author: Awaited<ReturnType<typeof account>>,
  outsider: Awaited<ReturnType<typeof account>>;
let form: Awaited<ReturnType<typeof reviews.configure>>,
  baseline: Record<string, unknown>,
  root: string,
  files: ReturnType<typeof createFilesService>,
  download: ReturnType<typeof createReviewFileDownload>;
const document = (): SubmissionDocument => ({
  title: `Synthetic paper ${rid()}`,
  abstract: "An anonymized synthetic abstract.",
  trackId: "science",
  topicIds: ["physics"],
  authors: [
    {
      name: "PRIVATE_AUTHOR_NAME",
      email: author.email,
      affiliation: "PRIVATE_AFFILIATION",
    },
  ],
  presenterIndex: 0,
  correspondingAuthorIndex: 0,
  keywords: [],
  presentationPreference: "either",
  competition: false,
  attachmentIds: [],
  slidesFileId: null,
  videoUrl: "",
});
async function submitted(patch: Partial<SubmissionDocument> = {}) {
  const draft = await submissions.save(
    author.raw,
    { id: rid(), expectedVersion: 0, document: { ...document(), ...patch } },
    rid(),
  );
  return submissions.transition(
    author.raw,
    { id: draft.id, expectedVersion: draft.version, action: "submit" },
    rid(),
  );
}
async function assigned(
  paper: Awaited<ReturnType<typeof submitted>>,
  who = reviewer,
  formId = form.id,
) {
  return reviews.assign(
    admin.raw,
    {
      id: rid(),
      submissionId: paper.id,
      revisionId: paper.currentRevisionId,
      reviewerId: who.id,
      formId,
      anonymousConfirmed: true,
    },
    rid(),
  );
}
async function score(assignment: ReviewAssignment, who = reviewer) {
  const accepted = await reviews.action(
    who.raw,
    {
      id: assignment.id,
      expectedVersion: assignment.version,
      action: "accept",
    },
    rid(),
  );
  return reviews.action(
    who.raw,
    {
      id: accepted.id,
      expectedVersion: accepted.version,
      action: "submit",
      document: {
        scores: [{ criterionId: "quality", value: 4 }],
        authorComment: "PUBLIC_AUTHOR_COMMENT",
        privateComment: "PRIVATE_INTERNAL_COMMENT",
      },
    },
    rid(),
  );
}
async function decision(
  paper: Awaited<ReturnType<typeof submitted>>,
  patch: object = {},
) {
  return reviews.decide(
    chair.raw,
    {
      id: rid(),
      submissionId: paper.id,
      revisionId: paper.currentRevisionId,
      expectedVersion: 0,
      outcome: "accept_oral",
      authorMessage: "Accepted for oral presentation.",
      internalReason: "Synthetic chair reasoning",
      revisionDeadline: null,
      ...patch,
    },
    rid(),
  );
}
beforeAll(async () => {
  f.migrate();
  baseline = (await f.admin.query("SELECT * FROM confsys.submission_config"))
    .rows[0];
  admin = await account(["conference_admin"]);
  chair = await account(["chair"]);
  reviewer = await account(["reviewer"]);
  otherReviewer = await account(["reviewer"]);
  author = await account(["reviewer"]);
  outsider = await account();
  const config = await submissions.config(admin.raw);
  await submissions.configure(
    admin.raw,
    {
      ...config,
      opensAt: new Date(Date.now() - 60000).toISOString(),
      closesAt: new Date(Date.now() + 3600000).toISOString(),
      requireRegistration: false,
      requireAttachment: false,
      tracks: [
        {
          id: "science",
          name: "Science",
          topics: [{ id: "physics", name: "Physics" }],
        },
        { id: "other", name: "Other", topics: [] },
      ],
    },
    rid(),
  );
  await reviews.scope(
    admin.raw,
    { userId: chair.id, trackId: "science", remove: false },
    rid(),
  );
  form = await reviews.configure(
    admin.raw,
    {
      name: "Synthetic review",
      mode: "double_blind",
      closesAt: new Date(Date.now() + 3600000).toISOString(),
      criteria: [{ id: "quality", label: "Quality", max: 5 }],
    },
    rid(),
  );
  root = await mkdtemp(join(tmpdir(), "confsys-review-files-"));
  const storage = {
    root,
    scannerHost: "127.0.0.1",
    scannerPort: Number(process.env.CLAMAV_PORT ?? 53310),
  };
  files = createFilesService(f.app, f.config, storage);
  download = createReviewFileDownload(
    f.app,
    f.config,
    storage,
    authorizeReviewFile,
  );
});
afterAll(async () => {
  await f.admin.query(
    "DELETE FROM confsys.review_deadline_extensions WHERE assignment_id IN(SELECT id FROM confsys.review_assignments WHERE created_by=$1)",
    [admin.id],
  );
  const ids = (
    await f.admin.query<{ id: string }>(
      "SELECT id FROM confsys.users WHERE email LIKE $1",
      [`${f.prefix}%`],
    )
  ).rows.map((r) => r.id);
  const paperIds = (
    await f.admin.query<{ id: string }>(
      "SELECT id FROM confsys.submissions WHERE owner_id=ANY($1::uuid[])",
      [ids],
    )
  ).rows.map((r) => r.id);
  await f.admin.query(
    "DELETE FROM confsys.submission_revision_requests WHERE submission_id=ANY($1::uuid[])",
    [paperIds],
  );
  const snapshots = await f.admin.query(
    "SELECT to_regclass('confsys.review_publication_snapshots') AS present",
  );
  if (snapshots.rows[0].present)
    await f.admin.query(
      "DELETE FROM confsys.review_publication_snapshots WHERE decision_id IN(SELECT id FROM confsys.review_decisions WHERE submission_id=ANY($1::uuid[]))",
      [paperIds],
    );
  for (const table of [
    "review_screenings",
    "review_publications",
    "review_decisions",
    "review_conflicts",
    "review_assignments",
  ])
    await f.admin.query(
      `DELETE FROM confsys.${table} WHERE submission_id=ANY($1::uuid[])`,
      [paperIds],
    );
  await f.admin.query(
    "DELETE FROM confsys.review_forms WHERE created_by=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.review_chair_scopes WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
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
  if (baseline)
    await f.admin.query(
      "UPDATE confsys.submission_config SET version=$1,document=$2",
      [baseline.version, baseline.document],
    );
  await f.cleanup();
  if (root) await rm(root, { recursive: true, force: true });
});
it("scope, explicit roles, self/coauthor conflict and anonymous confirmation constrain assignment", async () => {
  const paper = await submitted(),
    input = {
      id: rid(),
      submissionId: paper.id,
      revisionId: paper.currentRevisionId,
      reviewerId: reviewer.id,
      formId: form.id,
      anonymousConfirmed: true,
    };
  await expect(
    reviews.assign(outsider.raw, input, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    reviews.assign(admin.raw, { ...input, reviewerId: author.id }, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    reviews.assign(admin.raw, { ...input, anonymousConfirmed: false }, rid()),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  const other = await submitted({ trackId: "other", topicIds: [] });
  await expect(
    reviews.assign(
      chair.raw,
      { ...input, submissionId: other.id, revisionId: other.currentRevisionId },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const coauthor = await submitted({
    authors: [
      {
        name: "Reviewer author",
        email: reviewer.email,
        affiliation: "Synthetic",
      },
    ],
  });
  await expect(assigned(coauthor)).rejects.toMatchObject({ code: "FORBIDDEN" });
  const result = await reviews.assign(chair.raw, input, rid());
  expect(result.paper.authors).toEqual([]);
  expect(JSON.stringify(result)).not.toMatch(
    /PRIVATE_AUTHOR|PRIVATE_AFFILIATION/,
  );
  expect(await reviews.assign(chair.raw, input, rid())).toEqual(result);
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM confsys.notifications WHERE event_key=$1",
        [`review-assigned:${result.id}`],
      )
    ).rows[0].count,
  ).toBe("1");
  const hidden = await withIdentityTransaction(f.app, async (db) => {
    await context(db, otherReviewer.id);
    return db.query("SELECT id FROM confsys.review_assignments WHERE id=$1", [
      result.id,
    ]);
  });
  expect(hidden.rows).toHaveLength(0);
  await expect(
    reviews.action(
      otherReviewer.raw,
      { id: result.id, expectedVersion: 1, action: "accept" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("reviewer accepts pinned revision, saves drafts, validates rubric and submits exactly once under concurrency", async () => {
  const paper = await submitted(),
    assignment = await assigned(paper);
  const accepted = await reviews.action(
    reviewer.raw,
    { id: assignment.id, expectedVersion: 1, action: "accept" },
    rid(),
  );
  await expect(
    reviews.action(
      reviewer.raw,
      {
        id: assignment.id,
        expectedVersion: accepted.version,
        action: "submit",
        document: { scores: [], authorComment: "", privateComment: "" },
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  for (const scores of [
    [{ criterionId: "quality", value: 6 }],
    [{ criterionId: "unknown", value: 1 }],
    [
      { criterionId: "quality", value: 1 },
      { criterionId: "quality", value: 2 },
    ],
  ])
    await expect(
      reviews.action(
        reviewer.raw,
        {
          id: assignment.id,
          expectedVersion: accepted.version,
          action: "save",
          document: { scores, authorComment: "Draft", privateComment: "" },
        },
        rid(),
      ),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  const saved = await reviews.action(
    reviewer.raw,
    {
      id: assignment.id,
      expectedVersion: accepted.version,
      action: "save",
      document: {
        scores: [{ criterionId: "quality", value: 4 }],
        authorComment: "PUBLIC_AUTHOR_COMMENT",
        privateComment: "PRIVATE_INTERNAL_COMMENT",
      },
    },
    rid(),
  );
  const outcomes = await Promise.allSettled([
    reviews.action(
      reviewer.raw,
      {
        id: saved.id,
        expectedVersion: saved.version,
        action: "submit",
        document: saved.document,
      },
      rid(),
    ),
    reviews.action(
      reviewer.raw,
      {
        id: saved.id,
        expectedVersion: saved.version,
        action: "submit",
        document: saved.document,
      },
      rid(),
    ),
  ]);
  expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
  const locked = (await reviews.assigned(reviewer.raw, {})).items.find(
    (a) => a.id === saved.id,
  )!;
  expect(locked.state).toBe("submitted");
  await expect(
    reviews.action(
      reviewer.raw,
      {
        id: locked.id,
        expectedVersion: locked.version,
        action: "save",
        document: locked.document,
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const changed = await submissions.save(
    author.raw,
    {
      id: paper.id,
      expectedVersion: paper.version,
      document: { ...paper.document, title: "New author draft" },
    },
    rid(),
  );
  expect(changed.version).toBeGreaterThan(paper.version);
  expect(
    (await reviews.assigned(reviewer.raw, {})).items.find(
      (a) => a.id === saved.id,
    )?.paper.title,
  ).toBe(paper.document.title);
});
it("chair decisions stay private until publication; published author projection excludes internal scores and identities", async () => {
  const paper = await submitted();
  const scored = await score(await assigned(paper));
  const payload = {
    id: rid(),
    submissionId: paper.id,
    revisionId: paper.currentRevisionId,
    expectedVersion: 0,
    outcome: "accept_oral",
    authorMessage: "Accepted for oral presentation.",
    internalReason: "PRIVATE_DECISION_REASON",
    revisionDeadline: null,
  };
  await expect(reviews.decide(admin.raw, payload, rid())).rejects.toMatchObject(
    { code: "FORBIDDEN" },
  );
  const draft = await reviews.decide(chair.raw, payload, rid());
  expect(draft.published).toBe(false);
  expect(await reviews.decide(chair.raw, payload, rid())).toEqual(draft);
  expect(
    (await reviews.authorResults(author.raw, {})).items.find(
      (r) => r.submissionId === paper.id,
    ),
  ).toBeUndefined();
  await expect(reviews.board(author.raw, {})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const authorRows = await withIdentityTransaction(f.app, async (db) => {
    await context(db, author.id);
    return db.query("SELECT * FROM confsys.review_decisions");
  });
  expect(authorRows.rows).toHaveLength(0);
  await reviews.publish(chair.raw, { id: draft.id }, rid());
  await reviews.publish(chair.raw, { id: draft.id }, rid());
  const results = await reviews.authorResults(author.raw, {}),
    result = results.items.find((r) => r.submissionId === paper.id);
  expect(result?.outcome).toBe("accept_oral");
  expect(result?.authorComments).toContain("PUBLIC_AUTHOR_COMMENT");
  await reviews.action(
    reviewer.raw,
    {
      id: scored.id,
      expectedVersion: scored.version,
      action: "conflict",
      reason: "Relationship discovered after publication",
    },
    rid(),
  );
  expect(
    (await reviews.authorResults(author.raw, {})).items.find(
      (r) => r.submissionId === paper.id,
    )?.authorComments,
  ).toContain("PUBLIC_AUTHOR_COMMENT");
  expect(JSON.stringify(results)).not.toMatch(
    /PRIVATE_|privateComment|reviewerId|scores/,
  );
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM confsys.notifications WHERE event_key=$1",
        [`review-result:${draft.id}`],
      )
    ).rows[0].count,
  ).toBe("1");
  const next = await decision(paper, {
    expectedVersion: 1,
    outcome: "reject",
    authorMessage: "Revised result",
    internalReason: "Correction reason",
  });
  expect(
    (await reviews.authorResults(author.raw, {})).items.find(
      (r) => r.submissionId === paper.id,
    )?.outcome,
  ).toBe("accept_oral");
  await reviews.publish(chair.raw, { id: next.id }, rid());
  expect(
    (await reviews.authorResults(author.raw, {})).items.find(
      (r) => r.submissionId === paper.id,
    )?.outcome,
  ).toBe("reject");
});
it("private download authorizes accepted assignment and masks filename; conflict immediately blocks scoring and downloads", async () => {
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=";
  const file = await files.upload(
    author.raw,
    {
      purpose: "manuscript",
      name: "PRIVATE_AUTHOR_IDENTITY.png",
      content: png,
    },
    rid(),
  );
  expect(file.status).toBe("ready");
  const paper = await submitted({ attachmentIds: [file.id] }),
    assignment = await assigned(paper);
  await expect(
    download(reviewer.raw, assignment.id, file.id, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const accepted = await reviews.action(
    reviewer.raw,
    { id: assignment.id, expectedVersion: 1, action: "accept" },
    rid(),
  );
  const downloaded = await download(
    reviewer.raw,
    assignment.id,
    file.id,
    rid(),
  );
  expect(downloaded.name).toBe(`manuscript-${file.id}.png`);
  expect(downloaded.bytes.length).toBeGreaterThan(0);
  await expect(
    download(otherReviewer.raw, assignment.id, file.id, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    files.download(reviewer.raw, file.id, rid()),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const conflict = await reviews.action(
    reviewer.raw,
    {
      id: assignment.id,
      expectedVersion: accepted.version,
      action: "conflict",
      reason: "Synthetic declared relationship",
    },
    rid(),
  );
  expect(conflict.state).toBe("conflicted");
  expect(conflict.paper.attachmentIds).toEqual([]);
  await expect(
    download(reviewer.raw, assignment.id, file.id, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    reviews.action(
      reviewer.raw,
      {
        id: conflict.id,
        expectedVersion: conflict.version,
        action: "save",
        document: { scores: [], authorComment: "", privateComment: "" },
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("single blind exposes only configured author name/affiliation; declined reviews have no manuscript projection", async () => {
  const single = await reviews.configure(
    admin.raw,
    { ...form.document, mode: "single_blind" },
    rid(),
  );
  const paper = await submitted(),
    assignment = await assigned(paper, otherReviewer, single.id);
  const mine = (await reviews.assigned(otherReviewer.raw, {})).items.find(
    (a) => a.id === assignment.id,
  )!;
  expect(mine.paper.authors[0]?.name).toBe("PRIVATE_AUTHOR_NAME");
  expect(JSON.stringify(mine)).not.toContain(author.email);
  const declined = await reviews.action(
    otherReviewer.raw,
    { id: mine.id, expectedVersion: mine.version, action: "decline" },
    rid(),
  );
  expect(declined.state).toBe("declined");
  expect(declined.paper.title).toBe("");
});
it("revision request is published separately and audit failure rolls back decision publication/outbox", async () => {
  const paper = await submitted(),
    draft = await decision(paper, {
      outcome: "revision_requested",
      revisionDeadline: new Date(Date.now() + 3600000).toISOString(),
    });
  expect(
    (
      await f.admin.query(
        "SELECT id FROM confsys.submission_revision_requests WHERE decision_id=$1",
        [draft.id],
      )
    ).rows,
  ).toHaveLength(0);
  const failure = rid();
  await f.admin.query(
    `CREATE FUNCTION confsys.test_review_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${failure}'::uuid THEN RAISE EXCEPTION 'synthetic audit failure'; END IF; RETURN NEW; END $$`,
  );
  await f.admin.query(
    "CREATE TRIGGER test_review_failure BEFORE INSERT ON confsys.auth_audit FOR EACH ROW EXECUTE FUNCTION confsys.test_review_failure()",
  );
  try {
    await expect(
      reviews.publish(chair.raw, { id: draft.id }, failure),
    ).rejects.toThrow();
    expect(
      (await reviews.authorResults(author.raw, {})).items.find(
        (r) => r.submissionId === paper.id,
      ),
    ).toBeUndefined();
    expect(
      (
        await f.admin.query(
          "SELECT id FROM confsys.notifications WHERE event_key=$1",
          [`review-result:${draft.id}`],
        )
      ).rows,
    ).toHaveLength(0);
  } finally {
    await f.admin.query(
      "DROP TRIGGER test_review_failure ON confsys.auth_audit",
    );
    await f.admin.query("DROP FUNCTION confsys.test_review_failure()");
  }
  await reviews.publish(chair.raw, { id: draft.id }, rid());
  expect(
    (
      await f.admin.query(
        "SELECT revision_id,new_revision_id FROM confsys.submission_revision_requests WHERE decision_id=$1",
        [draft.id],
      )
    ).rows[0],
  ).toEqual({ revision_id: paper.currentRevisionId, new_revision_id: null });
});
it("revoked reviewer session and withdrawn paper fail closed", async () => {
  const paper = await submitted(),
    assignedReview = await assigned(paper);
  await submissions.transition(
    author.raw,
    { id: paper.id, expectedVersion: paper.version, action: "withdraw" },
    rid(),
  );
  expect(
    (await reviews.assigned(reviewer.raw, {})).items.find(
      (r) => r.id === assignedReview.id,
    ),
  ).toBeUndefined();
  await expect(
    reviews.action(
      reviewer.raw,
      { id: assignedReview.id, expectedVersion: 1, action: "accept" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await access.mutate(
    admin.raw,
    otherReviewer.id,
    {
      action: "revoke",
      role: "reviewer",
      reason: "Synthetic reviewer revocation",
    },
    rid(),
  );
  await expect(reviews.assigned(otherReviewer.raw, {})).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
});
it("chair conflict declaration is scoped, irreversible and immediately fences decisions", async () => {
  const paper = await submitted(),
    other = await submitted({ trackId: "other", topicIds: [] });
  await expect(
    reviews.conflict(
      chair.raw,
      { submissionId: other.id, reason: "Synthetic relationship" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    await reviews.conflict(
      chair.raw,
      { submissionId: paper.id, reason: "Synthetic relationship" },
      rid(),
    ),
  ).toEqual({ changed: true });
  expect(
    await reviews.conflict(
      chair.raw,
      { submissionId: paper.id, reason: "Synthetic relationship" },
      rid(),
    ),
  ).toEqual({ changed: false });
  await expect(decision(paper)).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (await reviews.board(chair.raw, {})).papers.find(
      (p) => p.submissionId === paper.id,
    ),
  ).toBeUndefined();
});

it("screening is versioned, role/track scoped, private and gates existing scoring and positive publication", async () => {
  const p = await submitted(),
    strict = await reviews.configure(
      admin.raw,
      { ...form.document, requireScreening: true },
      rid(),
    );
  await expect(assigned(p, reviewer, strict.id)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const input = {
    id: rid(),
    submissionId: p.id,
    revisionId: p.currentRevisionId,
    expectedVersion: 0,
    outcome: "ready",
    reason: "PRIVATE_INITIAL_SCREEN_REASON",
  };
  await expect(reviews.screen(author.raw, input, rid())).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  const first = await reviews.screen(chair.raw, input, rid());
  expect((await reviews.screen(chair.raw, input, rid())).id).toBe(first.id);
  const a = await assigned(p, reviewer, strict.id);
  expect(a.screening).toBe("ready");
  await withIdentityTransaction(f.app, async (db) => {
    await context(db, reviewer.id);
    expect(
      (
        await db.query(
          "SELECT id FROM confsys.review_screenings WHERE revision_id=$1",
          [p.currentRevisionId],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await db.query(
          "SELECT outcome FROM confsys.review_screening_status WHERE revision_id=$1",
          [p.currentRevisionId],
        )
      ).rows[0].outcome,
    ).toBe("ready");
  });
  expect(
    JSON.stringify(await reviews.assigned(reviewer.raw, {})),
  ).not.toContain(input.reason);
  const accepted = await reviews.action(
      reviewer.raw,
      { id: a.id, expectedVersion: a.version, action: "accept" },
      rid(),
    ),
    d = await decision(p);
  const blocked = await reviews.screen(
    chair.raw,
    {
      ...input,
      id: rid(),
      expectedVersion: 1,
      outcome: "ineligible",
      reason: "Synthetic later eligibility finding",
    },
    rid(),
  );
  expect(blocked.version).toBe(2);
  await expect(
    reviews.action(
      reviewer.raw,
      {
        id: a.id,
        expectedVersion: accepted.version,
        action: "save",
        document: { scores: [], authorComment: "", privateComment: "" },
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    reviews.publish(chair.raw, { id: d.id }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(decision(p, { expectedVersion: 1 })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const correction = await decision(p, {
    expectedVersion: 1,
    outcome: "revision_requested",
    revisionDeadline: new Date(Date.now() + 60000).toISOString(),
  });
  await reviews.publish(chair.raw, { id: correction.id }, rid());
  const declinedPaper = await submitted(),
    pending = await assigned(declinedPaper);
  await reviews.screen(
    admin.raw,
    {
      ...input,
      id: rid(),
      submissionId: declinedPaper.id,
      revisionId: declinedPaper.currentRevisionId,
      outcome: "needs_correction",
    },
    rid(),
  );
  expect(
    (
      await reviews.action(
        reviewer.raw,
        { id: pending.id, expectedVersion: pending.version, action: "decline" },
        rid(),
      )
    ).state,
  ).toBe("declined");
  const other = await submitted({
    ...document(),
    trackId: "other",
    topicIds: [],
  });
  await expect(
    reviews.screen(
      chair.raw,
      {
        ...input,
        id: rid(),
        submissionId: other.id,
        revisionId: other.currentRevisionId,
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    f.app.query(
      "UPDATE confsys.review_screenings SET reason='Changed' WHERE id=$1",
      [first.id],
    ),
  ).rejects.toMatchObject({ code: "42501" });
});
it("screening optimistic versions prevent overwrite and pending reminders are scoped retry-safe outbox events", async () => {
  const p = await submitted(),
    input = {
      submissionId: p.id,
      revisionId: p.currentRevisionId,
      expectedVersion: 0,
      outcome: "ready",
      reason: "Synthetic concurrent initial screening",
    };
  const race = await Promise.allSettled([
    reviews.screen(admin.raw, { ...input, id: rid() }, rid()),
    reviews.screen(admin.raw, { ...input, id: rid() }, rid()),
  ]);
  expect(race.filter((v) => v.status === "fulfilled")).toHaveLength(1);
  expect(race.filter((v) => v.status === "rejected")).toHaveLength(1);
  const before = (await reviews.board(admin.raw, {})).workload.find(
      (w) => w.reviewerId === reviewer.id,
    ),
    a = await assigned(p),
    after = (await reviews.board(admin.raw, {})).workload.find(
      (w) => w.reviewerId === reviewer.id,
    );
  expect(after?.invited).toBe((before?.invited ?? 0) + 1);
  const reminder = {
    assignmentId: a.id,
    idempotencyKey: rid(),
    reason: "Synthetic deadline reminder",
  };
  await expect(
    reviews.remind(outsider.raw, reminder, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await reviews.remind(chair.raw, reminder, rid());
  await reviews.remind(chair.raw, reminder, rid());
  const sent = (
    await f.admin.query(
      "SELECT message_text FROM confsys.notifications WHERE event_key=$1",
      [`review-reminder:${a.id}:${reminder.idempotencyKey}`],
    )
  ).rows;
  expect(sent).toHaveLength(1);
  expect(sent[0].message_text).not.toContain(p.document.title);
  await score(a);
  await expect(
    reviews.remind(chair.raw, { ...reminder, idempotencyKey: rid() }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("initial-screen and audit roll back when the atomic reviewer notification cannot be persisted", async () => {
  const p = await submitted();
  await assigned(p);
  const screenId = rid(),
    failure = rid();
  await f.admin.query(
    `CREATE FUNCTION confsys.test_screen_notice_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${failure}' THEN RAISE EXCEPTION 'synthetic screening outbox failure'; END IF; RETURN NEW; END $$`,
  );
  await f.admin.query(
    "CREATE TRIGGER test_screen_notice_failure BEFORE INSERT ON confsys.notifications FOR EACH ROW EXECUTE FUNCTION confsys.test_screen_notice_failure()",
  );
  try {
    await expect(
      reviews.screen(
        admin.raw,
        {
          id: screenId,
          submissionId: p.id,
          revisionId: p.currentRevisionId,
          expectedVersion: 0,
          outcome: "needs_correction",
          reason: "Synthetic atomic initial screening",
        },
        failure,
      ),
    ).rejects.toThrow("synthetic screening outbox failure");
    expect(
      (
        await f.admin.query(
          "SELECT id FROM confsys.review_screenings WHERE id=$1",
          [screenId],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await f.admin.query(
          "SELECT id FROM confsys.auth_audit WHERE request_id=$1",
          [failure],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await f.admin.query(
          "SELECT id FROM confsys.notifications WHERE request_id=$1",
          [failure],
        )
      ).rowCount,
    ).toBe(0);
  } finally {
    await f.admin.query(
      "DROP TRIGGER test_screen_notice_failure ON confsys.notifications",
    );
    await f.admin.query("DROP FUNCTION confsys.test_screen_notice_failure()");
  }
});

it("auxiliary review metadata is denied without actor context and manager reads retain explicit scope", async () => {
  for (const table of [
    "review_forms",
    "review_chair_scopes",
    "review_conflicts",
    "submission_revision_requests",
    "competition_conflicts",
  ])
    expect((await f.app.query(`SELECT * FROM confsys.${table}`)).rows).toEqual(
      [],
    );
  expect(
    (await f.app.query("DELETE FROM confsys.review_chair_scopes")).rowCount,
  ).toBe(0);
  await expect(
    f.app.query(
      "INSERT INTO confsys.review_chair_scopes(user_id,track_id) VALUES($1,'forged')",
      [outsider.id],
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await withIdentityTransaction(f.app, async (db) => {
    await context(db, outsider.id, false);
    expect((await db.query("SELECT * FROM confsys.review_forms")).rows).toEqual(
      [],
    );
    expect(
      (await db.query("SELECT * FROM confsys.submission_revision_requests"))
        .rows,
    ).toEqual([]);
  });
  await withIdentityTransaction(f.app, async (db) => {
    await context(db, admin.id, true);
    expect(
      (
        await db.query("SELECT id FROM confsys.review_forms WHERE id=$1", [
          form.id,
        ])
      ).rowCount,
    ).toBe(1);
  });
});
it("changing a verified coauthor email cannot evade reviewer assignment or manager candidate conflicts", async () => {
  const alias = await account(["reviewer", "conference_admin"]);
  const paper = await submitted({
    authors: [
      ...document().authors,
      {
        name: "Historical coauthor",
        email: alias.email,
        affiliation: "Synthetic",
      },
    ],
  });
  const target = f.email();
  await auth.requestEmailChange(alias.raw, target, rid());
  await auth.confirmEmailChange(
    alias.raw,
    { token: (await f.link(alias.email, "email_change")).token },
    rid(),
  );
  const fresh = await auth.login(target, password, rid());
  await expect(
    assigned(paper, { id: alias.id, email: target, raw: fresh.raw }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (await reviews.board(fresh.raw, {})).papers.some(
      (row) => row.submissionId === paper.id,
    ),
  ).toBe(false);
});

it("extends only pending review deadlines with immutable form, scoped history, optimistic concurrency and replay", async () => {
  const p = await submitted(),
    localForm = await reviews.configure(
      admin.raw,
      {
        name: "Deadline fixture",
        mode: "single_blind",
        closesAt: new Date(Date.now() + 60000).toISOString(),
        criteria: [{ id: "quality", label: "Quality", max: 5 }],
      },
      rid(),
    );
  let a = await assigned(p, reviewer, localForm.id);
  // Operator-only fixture simulates the pinned form having elapsed without waiting.
  const expired = new Date(Date.now() - 60000).toISOString();
  await f.admin.query(
    "UPDATE confsys.review_forms SET document=jsonb_set(document,'{closesAt}',to_jsonb($2::text)) WHERE id=$1",
    [localForm.id, expired],
  );
  await expect(score(a)).rejects.toMatchObject({ code: "CONFLICT" });
  const input = {
    id: rid(),
    assignmentId: a.id,
    expectedVersion: a.version,
    deadline: new Date(Date.now() + 7200000).toISOString(),
    reason: "Explicit synthetic extension",
  };
  await expect(
    reviews.extendDeadline(reviewer.raw, input, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const extended = await reviews.extendDeadline(admin.raw, input, rid());
  expect(extended.form.document.closesAt).toBe(expired);
  expect(extended.effectiveDeadline).toBe(input.deadline);
  expect(extended.deadlineHistory).toHaveLength(1);
  expect(JSON.stringify(extended.deadlineHistory)).not.toContain(admin.id);
  expect(await reviews.extendDeadline(admin.raw, input, rid())).toEqual(
    extended,
  );
  await expect(
    reviews.extendDeadline(
      admin.raw,
      { ...input, reason: "Different replay reason" },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    reviews.extendDeadline(admin.raw, { ...input, id: rid() }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const requests = [0, 1].map(() => ({
    ...input,
    id: rid(),
    expectedVersion: extended.version,
    deadline: new Date(Date.now() + 10800000).toISOString(),
  }));
  const raced = await Promise.allSettled(
    requests.map((d) => reviews.extendDeadline(admin.raw, d, rid())),
  );
  expect(raced.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  a = (await reviews.assigned(reviewer.raw, { offset: 0 })).items.find(
    (x) => x.id === a.id,
  )!;
  expect(a.deadlineHistory).toHaveLength(2);
  await reviews.remind(
    admin.raw,
    {
      assignmentId: a.id,
      idempotencyKey: rid(),
      reason: "Extended pending assignment",
    },
    rid(),
  );
  const done = await score(a);
  await expect(
    reviews.extendDeadline(
      admin.raw,
      {
        ...input,
        id: rid(),
        expectedVersion: done.version,
        deadline: new Date(Date.now() + 14400000).toISOString(),
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await withIdentityTransaction(f.app, async (db) => {
    await context(db, otherReviewer.id, false);
    expect(
      (
        await db.query(
          "SELECT id FROM confsys.review_deadline_extensions WHERE assignment_id=$1",
          [a.id],
        )
      ).rowCount,
    ).toBe(0);
  });
  await expect(
    withIdentityTransaction(f.app, (db) =>
      db.query(
        "UPDATE confsys.review_deadline_extensions SET reason='rewritten' WHERE false",
      ),
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    withIdentityTransaction(f.app, async (db) => {
      await context(db, admin.id, true);
      return db.query(
        "INSERT INTO confsys.review_deadline_extensions(id,assignment_id,assignment_version,previous_deadline,deadline,reason,created_by) VALUES($1,$2,$3,$4,$5,'Forged basis',$6)",
        [
          rid(),
          a.id,
          done.version + 1,
          expired,
          new Date(Date.now() + 14400000),
          admin.id,
        ],
      );
    }),
  ).rejects.toMatchObject({ code: "23514" });
});

it("pins explicit review rounds and publishes only selected-round comments without rewriting prior scores", async () => {
  const p = await submitted(),
    first = await assigned(p);
  const nextInput = {
    id: rid(),
    submissionId: p.id,
    revisionId: p.currentRevisionId,
    reviewerId: reviewer.id,
    formId: form.id,
    anonymousConfirmed: true,
    round: 2,
  };
  await expect(
    reviews.assign(admin.raw, nextInput, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const scoredFirst = await score(first);
  const initial = await decision(p, { round: 1 });
  await reviews.publish(chair.raw, { id: initial.id }, rid());
  const firstSnapshot = (
    await f.admin.query(
      "SELECT author_comments FROM confsys.review_publication_snapshots WHERE decision_id=$1",
      [initial.id],
    )
  ).rows[0].author_comments;
  const secondForm = await reviews.configure(
    admin.raw,
    {
      ...form.document,
      name: "Second round immutable rubric",
      criteria: [{ id: "quality", label: "Revised quality", max: 10 }],
    },
    rid(),
  );
  const second = await reviews.assign(
    admin.raw,
    { ...nextInput, formId: secondForm.id },
    rid(),
  );
  expect(second.round).toBe(2);
  expect(second.form.id).toBe(secondForm.id);
  expect(second.document.scores).toEqual([]);
  await expect(
    reviews.assign(
      admin.raw,
      { ...nextInput, id: rid(), round: 1, reviewerId: otherReviewer.id },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    reviews.assign(admin.raw, { ...nextInput, id: rid() }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    decision(p, { round: 3, expectedVersion: initial.version }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const accepted = await reviews.action(
    reviewer.raw,
    { id: second.id, expectedVersion: second.version, action: "accept" },
    rid(),
  );
  await reviews.action(
    reviewer.raw,
    {
      id: accepted.id,
      expectedVersion: accepted.version,
      action: "submit",
      document: {
        scores: [{ criterionId: "quality", value: 8 }],
        authorComment: "SECOND_ROUND_COMMENT",
        privateComment: "SECOND_ROUND_PRIVATE",
      },
    },
    rid(),
  );
  const final = await decision(p, {
    round: 2,
    expectedVersion: initial.version,
  });
  await reviews.publish(chair.raw, { id: final.id }, rid());
  const published = (
    await reviews.authorResults(author.raw, { offset: 0 })
  ).items.find((r) => r.submissionId === p.id)!;
  expect(published.round).toBe(2);
  expect(published.authorComments).toEqual(["SECOND_ROUND_COMMENT"]);
  expect(
    (
      await f.admin.query(
        "SELECT author_comments FROM confsys.review_publication_snapshots WHERE decision_id=$1",
        [initial.id],
      )
    ).rows[0].author_comments,
  ).toEqual(firstSnapshot);
  const old = (await reviews.assigned(reviewer.raw, { offset: 0 })).items.find(
    (a) => a.id === first.id,
  )!;
  expect(old.document).toEqual(scoredFirst.document);
  expect(old.form.id).toBe(form.id);
  const board = await reviews.board(admin.raw, { offset: 0 });
  expect(
    board.rounds.filter((r) => r.revisionId === p.currentRevisionId),
  ).toEqual([
    {
      revisionId: p.currentRevisionId,
      round: 1,
      pending: 0,
      submitted: 1,
      closed: 0,
    },
    {
      revisionId: p.currentRevisionId,
      round: 2,
      pending: 0,
      submitted: 1,
      closed: 0,
    },
  ]);
  await expect(
    withIdentityTransaction(f.app, (db) =>
      db.query("UPDATE confsys.review_assignments SET round=1 WHERE false"),
    ),
  ).rejects.toMatchObject({ code: "42501" });
});

it("assignment INSERT requires manager context while reviewer scoring cannot alter the immutable basis", async () => {
  const p = await submitted();
  const direct = (actorId: string | null, manage = false) =>
    withIdentityTransaction(f.app, async (db) => {
      if (actorId) await context(db, actorId, manage);
      return db.query(
        "INSERT INTO confsys.review_assignments(id,submission_id,revision_id,reviewer_id,form_id,state,anonymous_confirmed,created_by) VALUES($1,$2,$3,$4,$5,'invited',true,$4)",
        [rid(), p.id, p.currentRevisionId, reviewer.id, form.id],
      );
    });
  await expect(direct(reviewer.id)).rejects.toMatchObject({ code: "42501" });
  await expect(direct(null)).rejects.toMatchObject({ code: "42501" });
  const a = await assigned(p);
  expect((await score(a)).state).toBe("submitted");
  for (const column of [
    "submission_id",
    "revision_id",
    "reviewer_id",
    "form_id",
    "anonymous_confirmed",
    "created_by",
    "round",
  ])
    await expect(
      withIdentityTransaction(f.app, async (db) => {
        await context(db, reviewer.id, false);
        return db.query(
          `UPDATE confsys.review_assignments SET ${column}=${column} WHERE id=$1`,
          [a.id],
        );
      }),
    ).rejects.toMatchObject({ code: "42501" });
});

it("publishes selected latest decisions atomically, rejects mixed authority/staleness and deduplicates retries", async () => {
  const first = await submitted(),
    second = await submitted();
  const one = await decision(first),
    old = await decision(second);
  const two = await decision(second, {
    expectedVersion: old.version,
    authorMessage: "Latest result",
  });
  const input = { ids: [one.id, two.id] };
  await expect(
    reviews.publishBatch(outsider.raw, input, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    reviews.publishBatch(chair.raw, { ids: [one.id, old.id] }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int AS n FROM confsys.review_publication_snapshots WHERE decision_id=ANY($1::uuid[])",
        [[one.id, old.id]],
      )
    ).rows[0].n,
  ).toBe(0);
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int AS n FROM confsys.notifications WHERE event_key=$1",
        [`review-result:${one.id}`],
      )
    ).rows[0].n,
  ).toBe(0);
  const foreignPaper = await submitted({ trackId: "other", topicIds: [] });
  await reviews.scope(
    admin.raw,
    { userId: chair.id, trackId: "other", remove: false },
    rid(),
  );
  const foreign = await decision(foreignPaper);
  await reviews.scope(
    admin.raw,
    { userId: chair.id, trackId: "other", remove: true },
    rid(),
  );
  await expect(
    reviews.publishBatch(chair.raw, { ids: [one.id, foreign.id] }, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(
    (
      await f.admin.query(
        "SELECT count(*)::int AS n FROM confsys.review_publication_snapshots WHERE decision_id=$1",
        [one.id],
      )
    ).rows[0].n,
  ).toBe(0);
  const results = await Promise.all([
    reviews.publishBatch(chair.raw, input, rid()),
    reviews.publishBatch(chair.raw, input, rid()),
  ]);
  for (const result of results)
    expect(result.items.map((item) => item.published)).toEqual([true, true]);
  for (const id of input.ids) {
    expect(
      (
        await f.admin.query(
          "SELECT count(*)::int AS n FROM confsys.review_publication_snapshots WHERE decision_id=$1",
          [id],
        )
      ).rows[0].n,
    ).toBe(1);
    expect(
      (
        await f.admin.query(
          "SELECT count(*)::int AS n FROM confsys.notifications WHERE event_key=$1",
          [`review-result:${id}`],
        )
      ).rows[0].n,
    ).toBe(1);
  }
  await expect(
    reviews.publishBatch(chair.raw, { ids: [one.id, one.id] }, rid()),
  ).rejects.toThrow();
  await expect(
    reviews.publishBatch(
      chair.raw,
      { ids: Array.from({ length: 51 }, rid) },
      rid(),
    ),
  ).rejects.toThrow();
});

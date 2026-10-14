import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { createAccessService } from "../../apps/api/src/access/service.js";
import { createRegistrationService } from "../../apps/api/src/registration/service.js";
import { createFinanceService } from "../../apps/api/src/finance/service.js";
import { createActivitiesService } from "../../apps/api/src/activities/service.js";
import { createFilesService } from "../../apps/api/src/files/service.js";
import { createSubmissionService } from "../../apps/api/src/submissions/service.js";
import { submissionDependencies } from "../../apps/api/src/submissions/dependencies.js";
import {
  createReviewService,
  authorizeReviewFile,
} from "../../apps/api/src/reviews/service.js";
import { createReviewFileDownload } from "../../apps/api/src/files/review-download.js";
import { createProgramService } from "../../apps/api/src/program/service.js";
import { createCompetitionService } from "../../apps/api/src/competitions/service.js";
import { createOnsiteService } from "../../apps/api/src/onsite/service.js";
import { createReceiptsService } from "../../apps/api/src/documents/service.js";
import { createExportJobsService } from "../../apps/api/src/export-jobs/service.js";
import { createReportingService } from "../../apps/api/src/reporting/service.js";
import { startExportWorker } from "../../packages/exports/src/worker.js";
import {
  createMailSender,
  processNotification,
} from "../../packages/notifications/src/worker.js";
const f = authFixture(),
  rid = () => randomUUID();
const auth = createAuthService(f.app, f.config),
  access = createAccessService(f.app, f.config),
  reg = createRegistrationService(f.app, f.config),
  finance = createFinanceService(f.app, f.config),
  activities = createActivitiesService(f.app, f.config),
  submissions = createSubmissionService(
    f.app,
    f.config,
    submissionDependencies,
  ),
  reviews = createReviewService(f.app, f.config),
  program = createProgramService(f.app, f.config),
  competitions = createCompetitionService(f.app, f.config),
  onsite = createOnsiteService(f.app, f.config),
  receipts = createReceiptsService(f.app, f.config),
  exports = createExportJobsService(f.app, f.config),
  reporting = createReportingService(f.app, f.config);
const users: string[] = [],
  programIds: string[] = [],
  competitionId = rid(),
  activityId = rid();
let root: string,
  registrationBaseline: number | null,
  submissionBaseline: { version: number; document: unknown },
  programBaseline: { version: number; active_publication_id: string | null };
const mail = createMailSender(f.workerConfig);
async function account() {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  const pending = await f.link(email);
  await processNotification(f.worker, f.workerConfig, pending.id, mail.send);
  const result = await fetch(
    `${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  ).then((r) => r.json());
  expect(result.messages).toHaveLength(1);
  const message = await fetch(
    `${process.env.MAILPIT_URL}/api/v1/message/${result.messages[0].ID}`,
  ).then((r) => r.json());
  const token = String(message.Text).match(/#token=([A-Za-z0-9_-]{43})/)?.[1];
  expect(token).toBeTruthy();
  await auth.consume("verify", token!, password, rid());
  const login = await auth.login(email, password, rid());
  users.push(login.account.user.id);
  return { id: login.account.user.id, email, raw: login.raw };
}
beforeAll(async () => {
  f.migrate();
  root = await mkdtemp(join(tmpdir(), "confsys-lifecycle-"));
  registrationBaseline = (
    await f.admin.query("SELECT version FROM confsys.registration_state")
  ).rows[0].version;
  submissionBaseline = (
    await f.admin.query(
      "SELECT version,document FROM confsys.submission_config",
    )
  ).rows[0];
  programBaseline = (
    await f.admin.query(
      "SELECT version,active_publication_id FROM confsys.program_state",
    )
  ).rows[0];
});
// Business creation below uses services only. Operator SQL is limited to baseline
// reads/assertions and deletion/restoration of this fixture's isolated resources.
afterAll(async () => {
  mail.close();
  if (users.length) {
    const q = (sql: string) => f.admin.query(sql, [users]);
    await q(
      "DELETE FROM confsys.export_jobs WHERE requester_id=ANY($1::uuid[])",
    );
    for (const table of ["receipt_revisions", "receipt_voids"])
      await q(
        `DELETE FROM confsys.${table} WHERE receipt_id IN(SELECT id FROM confsys.receipts WHERE order_id IN(SELECT id FROM confsys.orders WHERE user_id=ANY($1::uuid[])))`,
      );
    await q(
      "DELETE FROM confsys.receipts WHERE order_id IN(SELECT id FROM confsys.orders WHERE user_id=ANY($1::uuid[]))",
    );
    for (const [table, column] of [
      ["onsite_redemptions", "actor_id"],
      ["onsite_checkins", "actor_id"],
    ] as const)
      await q(`DELETE FROM confsys.${table} WHERE ${column}=ANY($1::uuid[])`);
    await q(
      "DELETE FROM confsys.onsite_tokens WHERE registration_id IN(SELECT id FROM confsys.registrations WHERE user_id=ANY($1::uuid[]))",
    );
    await f.admin.query(
      "UPDATE confsys.competitions SET active_publication_id=NULL,current_rubric_id=NULL WHERE id=$1",
      [competitionId],
    );
    await f.admin.query(
      "DELETE FROM confsys.competition_scores WHERE assignment_id IN(SELECT id FROM confsys.competition_assignments WHERE competition_id=$1)",
      [competitionId],
    );
    for (const table of [
      "competition_publications",
      "competition_conflicts",
      "competition_assignments",
      "competition_entries",
      "competition_rubrics",
    ])
      await f.admin.query(
        `DELETE FROM confsys.${table} WHERE competition_id=$1`,
        [competitionId],
      );
    await f.admin.query("DELETE FROM confsys.competitions WHERE id=$1", [
      competitionId,
    ]);
    await f.admin.query(
      "UPDATE confsys.program_state SET version=$1,active_publication_id=$2",
      [programBaseline.version, programBaseline.active_publication_id],
    );
    await q(
      "DELETE FROM confsys.program_publication_slots WHERE publication_id IN(SELECT id FROM confsys.program_publications WHERE published_by=ANY($1::uuid[]))",
    );
    await q(
      "DELETE FROM confsys.program_publications WHERE published_by=ANY($1::uuid[])",
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
        [programIds],
      );
    const ownedPapers =
      "SELECT id FROM confsys.submissions WHERE owner_id=ANY($1::uuid[])";
    await q(
      `DELETE FROM confsys.review_publication_snapshots WHERE decision_id IN(SELECT id FROM confsys.review_decisions WHERE submission_id IN(${ownedPapers}))`,
    );
    for (const table of [
      "review_publications",
      "submission_revision_requests",
      "review_decisions",
      "review_screenings",
      "review_assignments",
      "review_conflicts",
    ])
      await q(
        `DELETE FROM confsys.${table} WHERE submission_id IN(${ownedPapers})`,
      );
    await q(
      "DELETE FROM confsys.review_chair_scopes WHERE user_id=ANY($1::uuid[])",
    );
    await q(
      "DELETE FROM confsys.review_forms WHERE created_by=ANY($1::uuid[])",
    );
    await q(
      "UPDATE confsys.submissions SET state='draft',current_revision_id=NULL,submitted_version=NULL WHERE owner_id=ANY($1::uuid[])",
    );
    await q(
      "DELETE FROM confsys.submission_revisions WHERE owner_id=ANY($1::uuid[])",
    );
    await q("DELETE FROM confsys.submissions WHERE owner_id=ANY($1::uuid[])");
    await q(
      "DELETE FROM confsys.file_references WHERE file_id IN(SELECT id FROM confsys.file_assets WHERE owner_id=ANY($1::uuid[]))",
    );
    await q("DELETE FROM confsys.file_assets WHERE owner_id=ANY($1::uuid[])");
    await q(
      "DELETE FROM confsys.activity_bookings WHERE user_id=ANY($1::uuid[])",
    );
    await f.admin.query("DELETE FROM confsys.activities WHERE id=$1", [
      activityId,
    ]);
    await f.admin.query("DELETE FROM confsys.activity_versions WHERE id=$1", [
      activityId,
    ]);
    await q(
      "DELETE FROM confsys.payment_allocations WHERE created_by=ANY($1::uuid[])",
    );
    await q("DELETE FROM confsys.payments WHERE payer_id=ANY($1::uuid[])");
    await q(
      "DELETE FROM confsys.order_items WHERE order_id IN(SELECT id FROM confsys.orders WHERE user_id=ANY($1::uuid[]))",
    );
    await q("DELETE FROM confsys.orders WHERE user_id=ANY($1::uuid[])");
    await q("DELETE FROM confsys.registrations WHERE user_id=ANY($1::uuid[])");
    await f.admin.query("UPDATE confsys.registration_state SET version=$1", [
      registrationBaseline,
    ]);
    await q(
      "DELETE FROM confsys.registration_config_versions WHERE created_by=ANY($1::uuid[])",
    );
    await f.admin.query(
      "UPDATE confsys.submission_config SET version=$1,document=$2",
      [submissionBaseline.version, submissionBaseline.document],
    );
  }
  await f.cleanup();
  if (root) await rm(root, { recursive: true, force: true });
});

it("one participant traverses real registration, finance, submission, review, program, competition, onsite and document boundaries", async () => {
  const admin = await account(),
    participant = await account(),
    financeOfficer = await account(),
    chair = await account(),
    reviewerJudge = await account();
  await bootstrapAdministrator(
    f.admin,
    {
      conferenceName: f.config.CONFERENCE_NAME,
      origin: f.config.PUBLIC_APP_ORIGIN,
    },
    {
      targetId: admin.id,
      apply: true,
      reason: "Synthetic lifecycle bootstrap",
      confirmOrigin: f.config.PUBLIC_APP_ORIGIN,
    },
    rid(),
  );
  admin.raw = (await auth.login(admin.email, password, rid())).raw;
  for (const [person, role] of [
    [financeOfficer, "finance"],
    [chair, "chair"],
    [reviewerJudge, "reviewer"],
    [reviewerJudge, "competition_judge"],
  ] as const)
    await access.mutate(
      admin.raw,
      person.id,
      { action: "grant", role, reason: "Synthetic lifecycle duties" },
      rid(),
    );
  for (const person of [financeOfficer, chair, reviewerJudge])
    person.raw = (await auth.login(person.email, password, rid())).raw;
  const now = Date.now(),
    past = new Date(now - 60000).toISOString(),
    future = new Date(now + 3600000).toISOString(),
    ticket = rid();
  const config = await reg.configure(
    admin.raw,
    {
      expectedVersion: registrationBaseline ?? 0,
      document: {
        opensAt: past,
        closesAt: future,
        currency: "TWD",
        timezone: "Asia/Taipei",
        consent: "Synthetic lifecycle consent",
        fields: [
          {
            key: "meal",
            label: "Meal preference",
            type: "select",
            required: true,
            options: ["vegetarian", "standard"],
          },
        ],
        tickets: [
          {
            id: ticket,
            name: "Lifecycle attendee",
            capacity: 5,
            waitlist: false,
            rates: [{ startsAt: past, endsAt: future, amount: "1000" }],
          },
        ],
      },
    },
    rid(),
  );
  const registered = await reg.create(
    participant.raw,
    {
      idempotencyKey: rid(),
      configVersion: config.version,
      ticketId: ticket,
      badgeName: "Synthetic Participant",
      affiliation: "Synthetic Institute",
      consent: true,
      answers: { meal: "vegetarian" },
    },
    rid(),
  );
  expect(registered.state).toBe("confirmed");
  expect(registered.order?.paid).toBe("0");
  const pass = await onsite.pass(
    participant.raw,
    { registrationId: registered.id },
    rid(),
  );
  await expect(
    onsite.checkin(
      admin.raw,
      { token: pass.token, idempotencyKey: rid() },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const payment = await finance.submit(
    participant.raw,
    {
      idempotencyKey: rid(),
      amount: "1250",
      currency: "TWD",
      reference: `synthetic-transfer-${rid()}`,
      evidenceFileId: null,
    },
    rid(),
  );
  await expect(
    finance.verify(
      participant.raw,
      {
        id: payment.id,
        action: "verify",
        reason: "Participant cannot reconcile",
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await finance.verify(
    financeOfficer.raw,
    {
      id: payment.id,
      action: "verify",
      reason: "Synthetic transfer verified against ledger",
    },
    rid(),
  );
  await finance.allocate(
    financeOfficer.raw,
    {
      idempotencyKey: rid(),
      paymentId: payment.id,
      orderId: registered.order!.id,
      amount: "1000",
      reason: "Allocate verified registration fee",
    },
    rid(),
  );
  expect(
    (await reg.mine(participant.raw, 0)).items.find(
      (r) => r.id === registered.id,
    )?.order?.paid,
  ).toBe("1000");
  await activities.save(
    admin.raw,
    {
      id: activityId,
      expectedVersion: 0,
      document: {
        name: "Lifecycle vegetarian lunch",
        kind: "meal",
        startsAt: future,
        endsAt: new Date(now + 7200000).toISOString(),
        deadline: future,
        capacity: 5,
        amount: "250",
        currency: "TWD",
        mealTypes: ["vegetarian"],
        active: true,
      },
      reason: "Synthetic lifecycle meal setup",
    },
    rid(),
  );
  const booking = await activities.book(
    participant.raw,
    {
      activityId,
      version: 1,
      registrationId: registered.id,
      quantity: 1,
      mealType: "vegetarian",
      idempotencyKey: rid(),
    },
    rid(),
  );
  await expect(
    onsite.redeem(
      admin.raw,
      {
        token: pass.token,
        bookingId: booking.id,
        quantity: 1,
        idempotencyKey: rid(),
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await finance.allocate(
    financeOfficer.raw,
    {
      idempotencyKey: rid(),
      paymentId: payment.id,
      orderId: booking.orderId,
      amount: "250",
      reason: "Allocate verified meal fee",
    },
    rid(),
  );
  const storage = {
      root,
      scannerHost: "127.0.0.1",
      scannerPort: Number(process.env.CLAMAV_PORT ?? 53310),
    },
    files = createFilesService(f.app, f.config, storage);
  const manuscript = await files.upload(
    participant.raw,
    {
      purpose: "manuscript",
      name: "anonymous-synthetic-manuscript.png",
      content:
        "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=",
    },
    rid(),
  );
  expect(manuscript.status).toBe("ready");
  await submissions.configure(
    admin.raw,
    {
      version: submissionBaseline.version,
      opensAt: past,
      closesAt: future,
      requireRegistration: true,
      acceptedRegistrationDeadline: null,
      requireAttachment: true,
      mode: "abstract",
      presenterMustBeSubmitter: true,
      tracks: [
        {
          id: "lifecycle",
          name: "Lifecycle science",
          topics: [{ id: "integration", name: "Integration" }],
        },
      ],
    },
    rid(),
  );
  const draft = await submissions.save(
    participant.raw,
    {
      id: rid(),
      expectedVersion: 0,
      document: {
        title: "Synthetic cross-phase study",
        abstract: "An anonymous synthetic abstract for service integration.",
        keywords: ["integration"],
        correspondingAuthorIndex: 0,
        trackId: "lifecycle",
        topicIds: ["integration"],
        authors: [
          {
            name: "Synthetic Participant",
            email: participant.email,
            affiliation: "Synthetic Institute",
          },
        ],
        presenterIndex: 0,
        presentationPreference: "oral",
        competition: true,
        attachmentIds: [manuscript.id],
        slidesFileId: null,
        videoUrl: "",
      },
    },
    rid(),
  );
  const submitted = await submissions.transition(
    participant.raw,
    { id: draft.id, expectedVersion: draft.version, action: "submit" },
    rid(),
  );
  expect(submitted.currentRevisionId).toBeTruthy();
  const form = await reviews.configure(
    admin.raw,
    {
      name: "Lifecycle blinded review",
      mode: "double_blind",
      closesAt: future,
      requireScreening: true,
      criteria: [{ id: "quality", label: "Scientific quality", max: 5 }],
    },
    rid(),
  );
  await reviews.scope(
    admin.raw,
    { userId: chair.id, trackId: "lifecycle", remove: false },
    rid(),
  );
  await reviews.screen(
    admin.raw,
    {
      id: rid(),
      submissionId: submitted.id,
      revisionId: submitted.currentRevisionId,
      expectedVersion: 0,
      outcome: "ready",
      reason: "Synthetic manuscript meets submission requirements",
    },
    rid(),
  );
  const assignment = await reviews.assign(
    admin.raw,
    {
      id: rid(),
      submissionId: submitted.id,
      revisionId: submitted.currentRevisionId,
      reviewerId: reviewerJudge.id,
      formId: form.id,
      anonymousConfirmed: true,
    },
    rid(),
  );
  const download = createReviewFileDownload(
    f.app,
    f.config,
    storage,
    authorizeReviewFile,
  );
  await expect(
    download(reviewerJudge.raw, assignment.id, manuscript.id, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const accepted = await reviews.action(
    reviewerJudge.raw,
    {
      id: assignment.id,
      expectedVersion: assignment.version,
      action: "accept",
    },
    rid(),
  );
  expect(accepted.paper.authors).toEqual([]);
  expect(JSON.stringify(accepted)).not.toContain(participant.email);
  expect(
    (await download(reviewerJudge.raw, assignment.id, manuscript.id, rid()))
      .name,
  ).not.toContain("anonymous-synthetic");
  await reviews.action(
    reviewerJudge.raw,
    {
      id: assignment.id,
      expectedVersion: accepted.version,
      action: "submit",
      document: {
        scores: [{ criterionId: "quality", value: 5 }],
        authorComment: "Suitable for oral presentation.",
        privateComment: "Synthetic confidential reviewer reasoning.",
      },
    },
    rid(),
  );
  const decision = await reviews.decide(
    chair.raw,
    {
      id: rid(),
      submissionId: submitted.id,
      revisionId: submitted.currentRevisionId,
      expectedVersion: 0,
      outcome: "accept_oral",
      authorMessage: "Accepted for oral presentation.",
      internalReason: "Synthetic independent chair decision",
      revisionDeadline: null,
    },
    rid(),
  );
  expect((await reviews.authorResults(participant.raw, {})).items).toEqual([]);
  await reviews.publish(chair.raw, { id: decision.id }, rid());
  expect(
    (await reviews.authorResults(participant.raw, {})).items[0]?.outcome,
  ).toBe("accept_oral");
  const roomId = rid(),
    sessionId = rid(),
    slotId = rid();
  programIds.push(roomId, sessionId, slotId);
  const programVersion = async () => (await program.draft(admin.raw)).version;
  await program.room(
    admin.raw,
    {
      expectedVersion: await programVersion(),
      item: {
        id: roomId,
        name: "Lifecycle room",
        venue: "Synthetic venue",
        bufferMinutes: 0,
      },
    },
    rid(),
  );
  await program.session(
    admin.raw,
    {
      expectedVersion: await programVersion(),
      item: {
        id: sessionId,
        roomId,
        title: "Lifecycle oral session",
        startsAt: "2034-01-01T01:00:00Z",
        endsAt: "2034-01-01T02:00:00Z",
        chairName: "Synthetic Chair",
        chairEmail: chair.email,
      },
    },
    rid(),
  );
  await program.slot(
    admin.raw,
    {
      expectedVersion: await programVersion(),
      item: {
        id: slotId,
        sessionId,
        kind: "oral",
        revisionId: submitted.currentRevisionId,
        startsAt: "2034-01-01T01:00:00Z",
        endsAt: "2034-01-01T01:15:00Z",
        posterNumber: null,
        invitedTitle: "",
        invitedSpeaker: "",
        invitedAffiliation: "",
        invitedEmail: "",
      },
    },
    rid(),
  );
  const publicProgram = await program.publish(
    admin.raw,
    { expectedVersion: await programVersion() },
    rid(),
  );
  expect(
    publicProgram.sessions.find((s) => s.id === sessionId)?.slots[0]?.title,
  ).toBe(draft.document.title);
  const compConfig = {
    name: "Lifecycle oral competition",
    kind: "oral",
    registrationClosesAt: future,
    judgingClosesAt: new Date(now + 7200000).toISOString(),
    requireRegistration: true,
    minimumJudges: 1,
    tiePolicy: "shared",
    eligibilityNote: "Published accepted registered oral presenter",
    criteria: [
      { id: "quality", label: "Scientific quality", maximum: 100, weight: 1 },
    ],
  };
  await competitions.configure(
    admin.raw,
    { id: competitionId, expectedVersion: 0, config: compConfig },
    rid(),
  );
  const entry = (
    await competitions.enroll(
      participant.raw,
      { competitionId, revisionId: submitted.currentRevisionId },
      rid(),
    )
  ).entries.find((e) => e.competitionId === competitionId)!;
  await competitions.entry(
    admin.raw,
    {
      id: entry.id,
      expectedVersion: entry.version,
      action: "approve",
      reason: "Verified oral acceptance and registered presenter",
    },
    rid(),
  );
  const currentCompetition = async () =>
    (await competitions.admin(admin.raw, competitionId)).competitions.find(
      (c) => c.id === competitionId,
    )!;
  await competitions.configure(
    admin.raw,
    {
      id: competitionId,
      expectedVersion: (await currentCompetition()).version,
      config: {
        ...compConfig,
        registrationClosesAt: new Date(Date.now() - 1000).toISOString(),
      },
    },
    rid(),
  );
  await competitions.assign(
    admin.raw,
    { entryId: entry.id, judgeId: reviewerJudge.id },
    rid(),
  );
  const judging = (
    await competitions.judging(reviewerJudge.raw)
  ).assignments.find((a) => a.entryId === entry.id)!;
  await competitions.awards(
    admin.raw,
    {
      competitionId,
      expectedVersion: (await currentCompetition()).version,
      awards: [
        {
          entryId: entry.id,
          label: "Best synthetic oral presentation",
          rank: 1,
        },
      ],
      reason: "Synthetic award draft",
    },
    rid(),
  );
  await expect(
    competitions.publish(
      admin.raw,
      { competitionId, expectedVersion: (await currentCompetition()).version },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await competitions.score(
    reviewerJudge.raw,
    {
      assignmentId: judging.id,
      expectedVersion: judging.version,
      action: "submit",
      document: {
        scores: [{ criterionId: "quality", value: 90 }],
        comment: "Synthetic final judging score",
      },
    },
    rid(),
  );
  const awards = await competitions.publish(
    admin.raw,
    { competitionId, expectedVersion: (await currentCompetition()).version },
    rid(),
  );
  expect(
    awards.competitions.find((c) => c.id === competitionId)?.awards[0]
      ?.basisPoints,
  ).toBe(9000);
  const checkin = await onsite.checkin(
    admin.raw,
    { token: pass.token, idempotencyKey: rid() },
    rid(),
  );
  expect(checkin.active).toBe(true);
  const redemption = await onsite.redeem(
    admin.raw,
    {
      token: pass.token,
      bookingId: booking.id,
      quantity: 1,
      idempotencyKey: rid(),
    },
    rid(),
  );
  expect(redemption.active).toBe(true);
  await expect(
    onsite.redeem(
      admin.raw,
      {
        token: pass.token,
        bookingId: booking.id,
        quantity: 1,
        idempotencyKey: rid(),
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const receipt = await receipts.issue(
    financeOfficer.raw,
    {
      orderId: registered.order!.id,
      buyerName: "Synthetic Institute",
      buyerTaxId: "12345678",
      buyerAddress: "Synthetic address",
      reason: "Synthetic participant fee receipt",
    },
    rid(),
  );
  const pdf = await receipts.download(
    participant.raw,
    receipt.id,
    receipt.currentRevision,
    rid(),
  );
  expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect(pdf.bytes.length).toBeGreaterThan(1000);
  const job = await exports.create(
      admin.raw,
      {
        kind: "registrations",
        purpose: "Synthetic cross-phase operations verification",
        idempotencyKey: rid(),
      },
      rid(),
    ),
    worker = startExportWorker(
      f.worker,
      f.workerConfig,
      `lifecycle-export-${rid()}`,
    );
  try {
    await expect
      .poll(
        async () =>
          (await exports.list(admin.raw, {})).items.find((j) => j.id === job.id)
            ?.status,
        { timeout: 10000 },
      )
      .toBe("ready");
    const csv = (
      await exports.download(admin.raw, job.id, rid())
    ).bytes.toString();
    expect(csv).toContain(participant.email);
    expect(csv).toContain(registered.number);
    expect(csv).not.toContain("Synthetic confidential reviewer reasoning");
  } finally {
    await worker.close();
  }
  const notifications = (
    await f.admin.query(
      "SELECT id FROM confsys.notifications WHERE user_id=$1 AND kind='business' AND status='pending' ORDER BY created_at,id",
      [participant.id],
    )
  ).rows;
  expect(notifications.length).toBeGreaterThanOrEqual(5);
  for (const n of notifications)
    await processNotification(f.worker, f.workerConfig, n.id, mail.send);
  const inbox = await reporting.list(participant.raw, {});
  expect(inbox.items.some((n) => n.subject.includes("收據"))).toBe(true);
  expect(inbox.items.every((n) => n.status === "accepted")).toBe(true);
  expect(JSON.stringify(inbox)).not.toContain(
    "Synthetic confidential reviewer reasoning",
  );
}, 30000);

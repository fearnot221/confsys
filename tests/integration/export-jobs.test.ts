import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createExportJobsService } from "../../apps/api/src/export-jobs/service.js";
import {
  processExportJob,
  recoverExportJobs,
  startExportWorker,
} from "../../packages/exports/src/worker.js";
import { tokenHash } from "../../apps/api/src/auth/session.js";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  service = createExportJobsService(f.app, f.config);
const rid = () => randomUUID();
async function active(admin = false) {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const login = await auth.login(email, password, rid());
  if (admin)
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
      [login.account.user.id],
    );
  return { id: login.account.user.id, email, raw: login.raw };
}
let admin: Awaited<ReturnType<typeof active>>,
  other: Awaited<ReturnType<typeof active>>,
  ordinary: Awaited<ReturnType<typeof active>>;
const make = (kind = "submissions") =>
  service.create(admin.raw, { kind, idempotencyKey: rid() }, rid());
const get = async (id: string) =>
  (await service.list(admin.raw, {})).items.find((j) => j.id === id)!;
beforeAll(async () => {
  f.migrate();
  admin = await active(true);
  other = await active(true);
  ordinary = await active();
});
afterAll(async () => {
  const ids = (
    await f.admin.query<{ id: string }>(
      "SELECT id FROM confsys.users WHERE email LIKE $1",
      [`${f.prefix}%`],
    )
  ).rows.map((r) => r.id);
  await f.admin.query(
    "DELETE FROM confsys.export_jobs WHERE requester_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.submissions WHERE owner_id=ANY($1::uuid[])",
    [ids],
  );
  await f.cleanup();
});
it("requires fresh current authority, binds idempotency, scopes jobs and denies worker source rows without a real claim", async () => {
  const data = { kind: "emails", idempotencyKey: rid() };
  await expect(service.create(ordinary.raw, data, rid())).rejects.toMatchObject(
    { code: "FORBIDDEN" },
  );
  await f.admin.query(
    "UPDATE confsys.sessions SET password_verified_at=now()-interval '5 minutes' WHERE token_hash=$1",
    [tokenHash(admin.raw)],
  );
  await expect(service.create(admin.raw, data, rid())).rejects.toMatchObject({
    code: "REAUTH_REQUIRED",
  });
  await auth.reauthenticate(admin.raw, password, rid());
  const [a, b] = await Promise.all([
    service.create(admin.raw, data, rid()),
    service.create(admin.raw, data, rid()),
  ]);
  expect(a.id).toBe(b.id);
  await expect(
    service.create(admin.raw, { ...data, kind: "submissions" }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await service.list(other.raw, {})).items).toHaveLength(0);
  await expect(service.download(other.raw, a.id, rid())).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(service.download(admin.raw, a.id, rid())).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(
    (await f.worker.query("SELECT id FROM confsys.export_emails")).rows,
  ).toHaveLength(0);
  await expect(
    f.app.query("SELECT id FROM confsys.export_emails"),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    f.worker.query("SELECT email FROM confsys.users"),
  ).rejects.toMatchObject({ code: "42501" });
  await processExportJob(f.worker, a.id);
  expect((await get(a.id)).status).toBe("ready");
});
it("exports beyond1000 rows from one immutable snapshot, neutralizes formulas and verifies checksum on private download", async () => {
  const rows = Array.from({ length: 1005 }, (_, i) => ({
    id: rid(),
    title: i === 0 ? "=SYNTHETIC_FORMULA()" : `Synthetic export row ${i}`,
  }));
  await f.admin.query(
    "INSERT INTO confsys.submissions(id,owner_id,version,document) SELECT x.id,$1,1,jsonb_build_object('title',x.title,'trackId','science') FROM jsonb_to_recordset($2::jsonb) AS x(id uuid,title text)",
    [ordinary.id, JSON.stringify(rows)],
  );
  const expected = String(
      (await f.admin.query("SELECT count(*) FROM confsys.submissions")).rows[0]
        .count,
    ),
    job = await make();
  await processExportJob(f.worker, job.id, async () => {
    await f.admin.query(
      "UPDATE confsys.submissions SET document=jsonb_set(document,'{title}','\"CHANGED_AFTER_SNAPSHOT\"') WHERE id=$1",
      [rows[1]!.id],
    );
  });
  const ready = await get(job.id);
  expect(ready.status).toBe("ready");
  expect(ready.rows).toBe(expected);
  expect(ready.snapshotAt).not.toBeNull();
  const output = await service.download(admin.raw, job.id, rid()),
    csv = output.bytes.toString("utf8");
  expect(csv).toContain("'=SYNTHETIC_FORMULA()");
  expect(csv).toContain("Synthetic export row 1004");
  expect(csv).toContain("Synthetic export row 1");
  expect(csv).not.toContain("CHANGED_AFTER_SNAPSHOT");
  expect(csv).not.toContain("password_hash");
  const saved = (
    await f.admin.query("SELECT sha256 FROM confsys.export_jobs WHERE id=$1", [
      job.id,
    ])
  ).rows[0];
  expect(saved.sha256).toBe(
    createHash("sha256").update(output.bytes).digest("hex"),
  );
  await f.admin.query(
    "UPDATE confsys.export_jobs SET sha256=repeat('0',64) WHERE id=$1",
    [job.id],
  );
  await expect(
    service.download(admin.raw, job.id, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("fresh final transaction observes permission/credential revocation after source snapshot and download rechecks current rights", async () => {
  const job = await make("emails");
  await processExportJob(f.worker, job.id, async () => {
    await f.admin.query(
      "DELETE FROM confsys.user_roles WHERE user_id=$1 AND role='conference_admin'",
      [admin.id],
    );
  });
  expect(
    (
      await f.admin.query(
        "SELECT status,csv FROM confsys.export_jobs WHERE id=$1",
        [job.id],
      )
    ).rows[0],
  ).toMatchObject({ status: "cancelled", csv: null });
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
    [admin.id],
  );
  const epoch = await make("emails");
  await processExportJob(f.worker, epoch.id, async () => {
    await f.admin.query(
      "UPDATE confsys.users SET credential_version=credential_version+1 WHERE id=$1",
      [admin.id],
    );
  });
  admin.raw = (await auth.login(admin.email, password, rid())).raw;
  expect((await get(epoch.id)).status).toBe("cancelled");
  const ready = await make("emails");
  await processExportJob(f.worker, ready.id);
  await f.admin.query(
    "DELETE FROM confsys.user_roles WHERE user_id=$1 AND role='conference_admin'",
    [admin.id],
  );
  await expect(
    service.download(admin.raw, ready.id, rid()),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
    [admin.id],
  );
  await f.admin.query(
    "UPDATE confsys.users SET credential_version=credential_version+1 WHERE id=$1",
    [admin.id],
  );
  admin.raw = (await auth.login(admin.email, password, rid())).raw;
  await expect(
    service.download(admin.raw, ready.id, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("expires database output, bounds concurrent requests and recovers abandoned leases without pretending ready", async () => {
  const ready = await make("emails");
  await processExportJob(f.worker, ready.id);
  await f.admin.query(
    "UPDATE confsys.export_jobs SET created_at=now()-interval '24 hours',expires_at=now()-interval '1 second' WHERE id=$1",
    [ready.id],
  );
  await expect(
    service.download(admin.raw, ready.id, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await recoverExportJobs(f.worker);
  expect(
    (
      await f.admin.query(
        "SELECT status,csv FROM confsys.export_jobs WHERE id=$1",
        [ready.id],
      )
    ).rows[0],
  ).toMatchObject({ status: "expired", csv: null });
  const lost = await make("emails");
  await f.admin.query(
    "UPDATE confsys.export_jobs SET status='processing',attempts=1,claim_id=$2,lease_until=now()-interval '1 second' WHERE id=$1",
    [lost.id, rid()],
  );
  await recoverExportJobs(f.worker);
  expect((await get(lost.id)).status).toBe("pending");
  await f.admin.query(
    "UPDATE confsys.export_jobs SET status='processing',attempts=3,lease_until=now()-interval '1 second' WHERE id=$1",
    [lost.id],
  );
  await recoverExportJobs(f.worker);
  expect((await get(lost.id)).status).toBe("failed");
  for (let i = 0; i < 5; i++)
    await service.create(
      other.raw,
      { kind: "emails", idempotencyKey: rid() },
      rid(),
    );
  await expect(
    service.create(other.raw, { kind: "emails", idempotencyKey: rid() }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await f.admin.query(
    "UPDATE confsys.export_jobs SET status='cancelled' WHERE requester_id=$1 AND status='pending'",
    [other.id],
  );
});
it("dispatches and processes a persisted job through real Redis/BullMQ", async () => {
  const job = await make("emails"),
    worker = startExportWorker(
      f.worker,
      f.workerConfig,
      `export-test-${rid()}`,
    );
  try {
    await expect
      .poll(async () => (await get(job.id)).status, { timeout: 10000 })
      .toBe("ready");
    expect(
      (await service.download(admin.raw, job.id, rid())).bytes.toString(),
    ).toContain(admin.email);
  } finally {
    await worker.close();
  }
});

import { createHash, randomUUID } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { execFileSync } from "node:child_process";
import type { Page } from "@playwright/test";
import type { Pool } from "pg";
import {
  registrationConfigResult,
  registrationSchema,
  documentJob,
  documentJobList,
  onsitePass,
} from "@confsys/contracts";
import {
  exportJobSchema as exportJob,
  exportJobsPage as exportPage,
  csrfSchema,
} from "@confsys/contracts";
const sha = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
type Target = {
  run: string;
  envFile: string;
  project: string;
  origin: string;
  image: string;
  imageId: string;
};
export function assertRestoreFixtureTarget(target: Target) {
  if (
    !/^[a-f0-9]{8}$/.test(target.run) ||
    target.project !== `confsys-p6-${target.run}-a` ||
    !/^sha256:[a-f0-9]{64}$/.test(target.imageId)
  )
    throw new Error(
      "Restore fixture target must be this run A immutable image",
    );
  const expected = resolve(".instances", target.run, "a.env");
  if (
    resolve(target.envFile) !== expected ||
    realpathSync(target.envFile) !== expected
  )
    throw new Error("Restore fixture environment path mismatch");
  const stat = lstatSync(target.envFile);
  if (!stat.isFile() || (stat.mode & 0o777) !== 0o600)
    throw new Error(
      "Restore fixture environment must be an exclusive 0600 regular file",
    );
  const env = parseEnv(readFileSync(target.envFile, "utf8")),
    origin = new URL(target.origin);
  if (
    origin.hostname !== `a-${target.run}.localhost` ||
    origin.protocol !== "http:" ||
    !origin.port ||
    env.COMPOSE_PROJECT_NAME !== target.project ||
    env.PUBLIC_APP_ORIGIN !== target.origin ||
    env.APP_IMAGE !== target.image
  )
    throw new Error("Restore fixture target identity mismatch");
  const ids = execFileSync(
    "docker",
    [
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${target.project}`,
    ],
    { encoding: "utf8", timeout: 10000 },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  if (!ids.length) throw new Error("Restore fixture target containers missing");
  const containers: {
    Image: string;
    State: { Running: boolean };
    Config: { Labels: Record<string, string> };
  }[] = JSON.parse(
    execFileSync("docker", ["inspect", ...ids], {
      encoding: "utf8",
      timeout: 10000,
    }),
  );
  for (const name of ["api", "worker"]) {
    const rows = containers.filter(
      (c) => c.Config.Labels["com.docker.compose.service"] === name,
    );
    if (
      rows.length !== 1 ||
      rows[0]?.Config.Labels["com.docker.compose.project"] !== target.project ||
      rows[0]?.Image !== target.imageId ||
      !rows[0]?.State.Running
    )
      throw new Error(
        "Restore fixture target app identity or running state mismatch",
      );
  }
  return env;
}
// Called only after the harness has completed its original isolation checks. Creates products through real APIs/workers.
export async function enrichRestoreFixtures(
  target: Target & { page: Page; db: Pool; stopWorker: () => void },
) {
  assertRestoreFixtureTarget(target);
  const get = async (path: string) => {
    const response = await target.page.request.get(target.origin + path);
    if (response.status() !== 200)
      throw new Error(`Restore fixture GET failed (${response.status()})`);
    return response.json();
  };
  const post = async (path: string, data: object, status = 200) => {
    const csrf = csrfSchema.parse(await get("/api/auth/csrf"));
    const response = await target.page.request.post(target.origin + path, {
      data,
      headers: { origin: target.origin, "x-csrf-token": csrf.csrfToken },
    });
    if (response.status() !== status)
      throw new Error(`Restore fixture POST failed (${response.status()})`);
    return response.json();
  };
  const download = async (path: string) => {
    const response = await target.page.request.get(target.origin + path);
    if (response.status() !== 200)
      throw new Error(`Restore fixture download failed (${response.status()})`);
    const bytes = await response.body();
    if (bytes.length === 0 || bytes.length > 16 * 1024 * 1024)
      throw new Error("Restore fixture download size invalid");
    return bytes;
  };
  const initial = registrationConfigResult.parse(
    await get("/api/registration/config"),
  );
  if (initial.version !== 0 || initial.document !== null)
    throw new Error(
      "Restore enrichment refuses a preconfigured registration instance",
    );
  const start = new Date(Date.now() - 3600000).toISOString(),
    end = new Date(Date.now() + 86400000).toISOString(),
    ticketId = randomUUID();
  const configured = registrationConfigResult.parse(
    await post("/api/registration/config", {
      expectedVersion: 0,
      document: {
        opensAt: start,
        closesAt: end,
        currency: "TWD",
        timezone: "Asia/Taipei",
        consent: "Synthetic restore fixture only",
        fields: [],
        tickets: [
          {
            id: ticketId,
            name: "Synthetic restore free registration",
            capacity: 2,
            waitlist: false,
            rates: [{ startsAt: start, endsAt: end, amount: "0" }],
          },
        ],
      },
    }),
  );
  const registration = registrationSchema.parse(
    await post("/api/registration/create", {
      idempotencyKey: randomUUID(),
      configVersion: configured.version,
      ticketId,
      badgeName: "合成備份驗證",
      affiliation: "合成復原研究所",
      consent: true,
      answers: {},
    }),
  );
  if (registration.state !== "confirmed" || registration.order?.amount !== "0")
    throw new Error(
      "Restore fixture registration did not confirm with zero charge",
    );
  const pass = onsitePass.parse(
    await post("/api/onsite/pass", {
      registrationId: registration.id,
      rotate: false,
    }),
  );
  if (
    pass.registrationId !== registration.id ||
    pass.qrPath !== `/api/onsite/qr/${registration.id}`
  )
    throw new Error("Restore fixture QR scope mismatch");
  const qr = await download(pass.qrPath);
  if (!qr.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    throw new Error("Restore fixture QR is not PNG");
  const badge = documentJob.parse(
    await post("/api/document-jobs", {
      registrationIds: [registration.id],
      idempotencyKey: randomUUID(),
    }),
  );
  const csvJob = exportJob.parse(
    await post("/api/reporting/export-jobs", {
      kind: "registrations",
      purpose: "Synthetic same-instance disaster recovery verification",
      idempotencyKey: randomUUID(),
    }),
  );
  const deadline = Date.now() + 60000;
  let badgeReady = false,
    csvReady = false;
  while (Date.now() < deadline) {
    const b = documentJobList
        .parse(await get("/api/document-jobs?offset=0"))
        .items.find((j) => j.id === badge.id),
      c = exportPage
        .parse(await get("/api/reporting/export-jobs?offset=0"))
        .items.find((j) => j.id === csvJob.id);
    if (!b || !c)
      throw new Error("Restore fixture jobs missing from authorized list");
    if (
      ["failed", "cancelled"].includes(b.status) ||
      ["failed", "cancelled", "expired"].includes(c.status)
    )
      throw new Error("Restore fixture background generation failed");
    badgeReady = b.status === "ready";
    csvReady = c.status === "ready";
    if (badgeReady && csvReady) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  if (!badgeReady || !csvReady)
    throw new Error("Restore fixture background jobs timed out");
  const pdf = await download(`/api/document-jobs/${badge.id}/pdf`),
    csv = await download(`/api/reporting/export-jobs/${csvJob.id}/download`);
  if (
    pdf.subarray(0, 5).toString() !== "%PDF-" ||
    !csv.toString("utf8").includes("合成備份驗證")
  )
    throw new Error("Restore fixture rendered document content invalid");
  const storedPdf = (
    await target.db.query<{ pdf: Buffer }>(
      "SELECT pdf FROM confsys.document_jobs WHERE id=$1 AND status='ready'",
      [badge.id],
    )
  ).rows[0]?.pdf;
  const storedCsv = (
    await target.db.query<{ csv: Buffer }>(
      "SELECT csv FROM confsys.export_jobs WHERE id=$1 AND status='ready'",
      [csvJob.id],
    )
  ).rows[0]?.csv;
  const storedQr = (
    await target.db.query<{ token_hash: string }>(
      "SELECT token_hash FROM confsys.onsite_tokens WHERE registration_id=$1",
      [registration.id],
    )
  ).rows[0]?.token_hash;
  if (
    !storedPdf ||
    !storedCsv ||
    sha(storedPdf) !== sha(pdf) ||
    sha(storedCsv) !== sha(csv) ||
    storedQr !== sha(pass.token)
  )
    throw new Error("Restore fixture stored product verification failed");
  // All background artifacts are durable before pausing this exact run's worker. Keep it stopped for the recovery drill.
  target.stopWorker();
  const pendingEmail = `restore-pending-${target.run}@example.invalid`;
  await post("/api/auth/register", { email: pendingEmail }, 202);
  const envelope = (
    await target.db.query<{
      id: string;
      ciphertext: string;
      key_version: string;
    }>(
      "SELECT n.id,s.ciphertext,s.key_version FROM confsys.notifications n JOIN confsys.notification_secrets s ON s.notification_id=n.id JOIN confsys.users u ON u.id=n.user_id WHERE u.email=$1 AND n.kind='verify' AND n.status='pending'",
      [pendingEmail],
    )
  ).rows;
  if (envelope.length !== 1 || !envelope[0]?.ciphertext)
    throw new Error("Restore fixture pending encrypted outbox missing");
  return {
    status: "complete" as const,
    project: target.project,
    imageId: target.imageId,
    createdAt: new Date().toISOString(),
    workerStopped: true,
    counts: { badgePdf: 1, csv: 1, qrToken: 1, pendingEncryptedMail: 1 },
    artifacts: {
      badge: { id: badge.id, bytes: pdf.length, sha256: sha(pdf) },
      csv: { id: csvJob.id, bytes: csv.length, sha256: sha(csv) },
      qr: {
        registrationId: registration.id,
        pngBytes: qr.length,
        pngSha256: sha(qr),
        tokenHash: storedQr,
      },
      encryptedMail: {
        notificationId: envelope[0].id,
        ciphertextSha256: sha(envelope[0].ciphertext),
        keyVersion: envelope[0].key_version,
      },
    },
  };
}

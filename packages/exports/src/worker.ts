import { randomUUID, createHash } from "node:crypto";
import { Queue, Worker } from "bullmq";
import type { Pool, PoolClient } from "pg";
import { diagnostic, redisOptions, type WorkerConfig } from "@confsys/config";
import { withIdentityTransaction } from "@confsys/db";
import { permissionsFor } from "@confsys/policy";
import { exportJobInput,type ExportJob } from "@confsys/contracts";
import { csvCell, CsvBuffer } from "./csv.js";
const queueName = "data-exports-v1";
type Kind = ExportJob["kind"];
type Claim = { id: string; kind: Kind; claim_id: string };
const sources = {
  registrations: {
    view: "export_registrations",
    columns: [
      "id",
      "number",
      "state",
      "email",
      "badge_name",
      "affiliation",
      "ticket_name",
    ],
    headers: [
      "registration_id",
      "number",
      "state",
      "email",
      "badge_name",
      "affiliation",
      "ticket",
    ],
  },
  submissions: {
    view: "export_submissions",
    columns: [
      "id",
      "number",
      "state",
      "email",
      "title",
      "track",
      "version",
      "submitted_version",
    ],
    headers: [
      "submission_id",
      "number",
      "state",
      "owner_email",
      "title",
      "track",
      "version",
      "submitted_version",
    ],
  },
  emails: {
    view: "export_emails",
    columns: ["id", "email"],
    headers: ["user_id", "email"],
  },
} as const;
async function authorized(db: PoolClient, id: string) {
  await db.query(
    "SELECT singleton FROM confsys.access_control WHERE singleton=true FOR SHARE",
  );
  const row = (
    await db.query<{ requester_active: boolean; roles: string[] }>(
      "SELECT requester_active,roles FROM confsys.export_job_eligibility WHERE id=$1",
      [id],
    )
  ).rows[0];
  return (
    !!row?.requester_active &&
    permissionsFor(row.roles).includes("reporting.export")
  );
}
async function audit(db: PoolClient, id: string, event: string) {
  await db.query(
    "INSERT INTO confsys.auth_audit(id,event,event_id,request_id) VALUES($1,$2,$3,$3)",
    [randomUUID(), event, id],
  );
}
export async function recoverExportJobs(pool: Pool) {
  await pool.query(
    "UPDATE confsys.export_jobs SET status='expired',result_code='EXPIRED',csv=NULL,sha256=NULL,lease_until=NULL,completed_at=coalesce(completed_at,now()) WHERE expires_at<=clock_timestamp() AND status<>'expired'",
  );
  await pool.query(
    "UPDATE confsys.export_jobs SET status=CASE WHEN attempts>=3 THEN 'failed' ELSE 'pending' END,result_code='LEASE_EXPIRED',claim_id=NULL,lease_until=NULL WHERE status='processing' AND lease_until<clock_timestamp()",
  );
}
async function snapshot(pool: Pool, claim: Claim) {
  return withIdentityTransaction(pool, async (db) => {
    await db.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const stamp = (
      await db.query<{ snapshot_at: Date }>(
        "SELECT set_config('app.export_job_id',$1,true),set_config('app.export_claim_id',$2,true),statement_timestamp() AS snapshot_at",
        [claim.id, claim.claim_id],
      )
    ).rows[0]!.snapshot_at;
    const spec = sources[claim.kind],
      output = new CsvBuffer();
    let count = 0,
      cursor: string | null = null;
    const append = (text: string) => output.append(text);
    append("\uFEFF" + spec.headers.map(csvCell).join(",") + "\r\n");
    for (;;) {
      // View and column identifiers are static internal mappings, never request SQL.
      const rows: Record<string, unknown>[] = (
        await db.query<Record<string, unknown>>(
          `SELECT ${spec.columns.join(",")} FROM confsys.${spec.view} WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT 1000`,
          [cursor],
        )
      ).rows;
      for (const row of rows) {
        append(
          spec.columns.map((column) => csvCell(row[column])).join(",") + "\r\n",
        );
        count++;
        if (typeof row.id !== "string") throw new Error("INVALID_SOURCE");
        cursor = row.id;
      }
      if (rows.length < 1000) break;
    }
    return { bytes: output.finish(), count, stamp };
  });
}
export async function processExportJob(
  pool: Pool,
  id: string,
  afterSnapshot?: () => Promise<void>,
) {
  const claim = await withIdentityTransaction(pool, async (db) => {
    if (!(await authorized(db, id))) {
      await db.query(
        "UPDATE confsys.export_jobs SET status='cancelled',result_code='INELIGIBLE',completed_at=now() WHERE id=$1 AND status='pending'",
        [id],
      );
      return null;
    }
    const row = (
      await db.query<Claim>(
        "UPDATE confsys.export_jobs SET status='processing',claim_id=$2,lease_until=clock_timestamp()+interval '15 minutes',attempts=attempts+1,result_code=NULL WHERE id=$1 AND status='pending' AND attempts<3 AND expires_at>clock_timestamp() RETURNING id,kind,claim_id",
        [id, randomUUID()],
      )
    ).rows[0];
    if (!row) return null;
    exportJobInput.shape.kind.parse(row.kind);
    return row;
  });
  if (!claim) return;
  try {
    const result = await snapshot(pool, claim);
    // A regression test can revoke authority exactly at the snapshot boundary.
    // This callback cannot supply bytes or bypass the real source/authorization.
    if (afterSnapshot) await afterSnapshot();
    await withIdentityTransaction(pool, async (db) => {
      // NEW read-committed transaction: never reuse the old source snapshot for
      // final permission/credential checks, which must observe intervening revokes.
      const allowed = await authorized(db, id);
      const changed = await db.query(
        "UPDATE confsys.export_jobs SET status=$3,result_code=$4,csv=$5,sha256=$6,row_count=$7,snapshot_at=$8,completed_at=now(),lease_until=NULL WHERE id=$1 AND claim_id=$2 AND status='processing' AND lease_until>clock_timestamp() AND expires_at>clock_timestamp()",
        [
          id,
          claim.claim_id,
          allowed ? "ready" : "cancelled",
          allowed ? null : "INELIGIBLE",
          allowed ? result.bytes : null,
          allowed
            ? createHash("sha256").update(result.bytes).digest("hex")
            : null,
          allowed ? String(result.count) : null,
          allowed ? result.stamp : null,
        ],
      );
      if (changed.rowCount)
        await audit(db, id, allowed ? "export.ready" : "export.cancelled");
    });
  } catch (error) {
    const code =
      error instanceof Error && error.message === "EXPORT_TOO_LARGE"
        ? "EXPORT_TOO_LARGE"
        : "EXPORT_FAILED";
    await pool.query(
      "UPDATE confsys.export_jobs SET status='failed',result_code=$3,csv=NULL,sha256=NULL,completed_at=now(),lease_until=NULL WHERE id=$1 AND claim_id=$2 AND status='processing'",
      [id, claim.claim_id, code],
    );
  }
}
export async function dispatchExportJobs(pool: Pool, queue: Queue) {
  await recoverExportJobs(pool);
  const rows = (
    await pool.query<{ id: string }>(
      "SELECT id FROM confsys.export_jobs WHERE status='pending' ORDER BY created_at LIMIT 25",
    )
  ).rows;
  for (const row of rows)
    await queue.add(
      "csv",
      { id: row.id },
      {
        jobId: row.id,
        removeOnComplete: true,
        removeOnFail: true,
        attempts: 1,
      },
    );
}
export function startExportWorker(
  pool: Pool,
  config: WorkerConfig,
  name = queueName,
) {
  const queue = new Queue(name, { connection: redisOptions(config.REDIS_URL) }),
    worker = new Worker(
      name,
      async (job) => {
        const data: unknown = job.data;
        if (
          job.name !== "csv" ||
          !data ||
          typeof data !== "object" ||
          !("id" in data) ||
          typeof data.id !== "string" ||
          !/^[0-9a-f-]{36}$/.test(data.id) ||
          Object.keys(data).length !== 1
        )
          throw new Error("Invalid export job reference");
        await processExportJob(pool, data.id);
      },
      { connection: redisOptions(config.REDIS_URL), concurrency: 1 },
    );
  queue.on("error", () => diagnostic("export-dispatcher", "queue_unavailable"));
  worker.on("error", () => diagnostic("export-worker", "queue_unavailable"));
  worker.on("failed", (job) =>
    diagnostic(
      "export-worker",
      "job_failed",
      job?.id ? { eventId: job.id } : {},
    ),
  );
  let stopped = false,
    timer: ReturnType<typeof setTimeout> | undefined,
    inFlight: Promise<void> = Promise.resolve();
  const tick = async () => {
    try {
      await dispatchExportJobs(pool, queue);
    } catch {
      diagnostic("export-dispatcher", "dispatch_unavailable");
    }
    if (!stopped)
      timer = setTimeout(() => {
        inFlight = tick();
      }, 1000);
  };
  inFlight = tick();
  return {
    worker,
    async close() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await inFlight;
      await worker.close();
      await queue.close();
    },
  };
}

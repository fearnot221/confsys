import { Worker } from "bullmq";
import { redisOptions } from "@confsys/config";
import {
  syntheticJobSchema,
  SYNTHETIC_JOB,
  SYNTHETIC_QUEUE,
} from "@confsys/contracts";
export function createSyntheticWorker(
  redisUrl: string,
  queueName = SYNTHETIC_QUEUE,
) {
  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.name !== SYNTHETIC_JOB) throw new Error("Unsupported job");
      const { nonce } = syntheticJobSchema.parse(job.data);
      // Pure and retry-safe: no email, payments, tenant data or external effects.
      return { nonce, processed: true };
    },
    { connection: redisOptions(redisUrl), concurrency: 2 },
  );
  worker.on("error", () => console.error("Queue connection failed"));
  worker.on("failed", (job) =>
    console.error(
      JSON.stringify({ event: "synthetic_job_failed", jobId: job?.id }),
    ),
  );
  return worker;
}

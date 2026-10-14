import { it, expect } from "vitest";
import { Queue, QueueEvents } from "bullmq";
import { randomUUID } from "node:crypto";
import { createSyntheticWorker } from "../../apps/worker/src/worker.js";
import { redisOptions } from "@confsys/config";
import { SYNTHETIC_JOB } from "@confsys/contracts";
it("processes real Redis jobs, deduplicates stable IDs and rejects unsupported jobs", async () => {
  const url = process.env.TEST_REDIS_URL;
  if (
    !url ||
    !["localhost", "127.0.0.1"].includes(new URL(url).hostname) ||
    new URL(url).pathname !== "/1"
  )
    throw new Error("Local TEST_REDIS_URL database 1 required");
  const name = `phase0-test-${randomUUID()}`;
  const connection = redisOptions(url);
  const queue = new Queue(name, { connection });
  const events = new QueueEvents(name, { connection });
  const worker = createSyntheticWorker(url, name);
  try {
    await events.waitUntilReady();
    await worker.waitUntilReady();
    const nonce = randomUUID();
    const job = await queue.add(
      SYNTHETIC_JOB,
      { nonce },
      { jobId: nonce, attempts: 2, backoff: { type: "fixed", delay: 50 } },
    );
    expect(await job.waitUntilFinished(events, 8000)).toEqual({
      nonce,
      processed: true,
    });
    const duplicate = await queue.add(
      SYNTHETIC_JOB,
      { nonce },
      { jobId: nonce },
    );
    expect(duplicate.id).toBe(job.id);
    expect(await queue.getCompletedCount()).toBe(1);
    const failed = await queue.add(
      "unsupported",
      {},
      { attempts: 2, backoff: { type: "fixed", delay: 50 } },
    );
    await expect(failed.waitUntilFinished(events, 8000)).rejects.toThrow(
      "Unsupported job",
    );
    const final = await queue.getJob(failed.id!);
    expect(final?.attemptsMade).toBe(2);
  } finally {
    await worker.close();
    await events.close();
    await queue.obliterate({ force: true });
    await queue.close();
  }
});

import { localFetch } from "./local-http.js";
import { randomUUID } from "node:crypto";
import { Queue, QueueEvents } from "bullmq";
import { loadLocalConfig, redisOptions } from "@confsys/config";
import { createClient } from "@confsys/sdk";
import { SYNTHETIC_JOB, SYNTHETIC_QUEUE } from "@confsys/contracts";
loadLocalConfig();
const base = process.env.PUBLIC_APP_ORIGIN!;
const ready = await createClient(base, localFetch).getReadiness();
if (ready.status !== "ready") throw new Error("Stack not ready");
for (const [url, status] of [
  [base, 200],
  [`${base}/api/login`, 404],
  [`${process.env.MAILPIT_URL ?? "http://127.0.0.1:28025"}/readyz`, 200],
] as const) {
  const response = await localFetch(url, { signal: AbortSignal.timeout(5000) });
  if (response.status !== status)
    throw new Error(`Unexpected status from local service: ${response.status}`);
}
const url = process.env.REDIS_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname))
  throw new Error("Local Redis required");
const connection = redisOptions(url),
  nonce = randomUUID();
const queue = new Queue(SYNTHETIC_QUEUE, { connection }),
  events = new QueueEvents(SYNTHETIC_QUEUE, { connection });
try {
  await events.waitUntilReady();
  const job = await queue.add(
    SYNTHETIC_JOB,
    { nonce },
    {
      jobId: nonce,
      attempts: 2,
      backoff: { type: "fixed", delay: 100 },
      removeOnComplete: 100,
      removeOnFail: 100,
    },
  );
  const result: unknown = await job.waitUntilFinished(events, 10000);
  if (JSON.stringify(result) !== JSON.stringify({ nonce, processed: true }))
    throw new Error("Invalid worker result");
  await job.remove();
  console.log("Web, API, Mailpit and independently running worker verified");
} finally {
  await events.close();
  await queue.close();
}

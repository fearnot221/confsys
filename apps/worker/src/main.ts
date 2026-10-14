import {startDocumentWorker} from '@confsys/documents/worker';
import { startMailWorker } from "@confsys/notifications/worker";
import Fastify, { LogController } from "fastify";
import { Redis } from "ioredis";
import { loadWorkerConfig, diagnostic } from "@confsys/config";
import { createPool, databaseReady } from "@confsys/db";
import { createSyntheticWorker } from "./worker.js";
const config = loadWorkerConfig();
const pool = createPool(config.WORKER_DATABASE_URL);
const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  commandTimeout: 2000,
  connectTimeout: 2000,
  enableOfflineQueue: false,
});
redis.on("error", () => diagnostic("worker", "redis_unavailable"));
redis.on("ready", () => diagnostic("worker", "redis_ready"));
await databaseReady(pool, "confsys_worker");
const mail = startMailWorker(pool, config);
const documents = startDocumentWorker(pool,config);
const worker = createSyntheticWorker(config.REDIS_URL);
let queueReady = false;
void worker
  .waitUntilReady()
  .then(() => {
    queueReady = true;
  })
  .catch(() => {
    diagnostic("worker", "queue_startup_failed");
  });
const app = Fastify({
  logger: true,
  logController: new LogController({ disableRequestLogging: true }),
});
app.get("/health/live", async () => ({ status: "alive" }));
app.get("/health/ready", async (_request, reply) => {
  try {
    await databaseReady(pool, "confsys_worker");
    if (
      (await redis.ping()) !== "PONG" ||
      !queueReady ||
      !worker.isRunning() ||
      !mail.worker.isRunning() ||
      !documents.worker.isRunning() ||
      worker.isPaused()
    )
      throw new Error("Not ready");
    return { status: "ready" };
  } catch {
    return reply.code(503).send({ status: "not_ready" });
  }
});
app.addHook("onClose", async () => {
  await documents.close();
  await mail.close();
  await worker.close();
  redis.disconnect();
  await pool.end();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: config.WORKER_HOST, port: config.WORKER_PORT });

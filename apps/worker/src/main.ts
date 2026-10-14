import Fastify, { LogController } from "fastify";
import { Redis } from "ioredis";
import { loadConfig } from "@confsys/config";
import { createPool, databaseReady } from "@confsys/db";
import { createSyntheticWorker } from "./worker.js";
const config = loadConfig();
const pool = createPool(config.WORKER_DATABASE_URL);
const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  commandTimeout: 2000,
  connectTimeout: 2000,
  enableOfflineQueue: false,
});
redis.on("error", () => {});
const worker = createSyntheticWorker(config.REDIS_URL);
let queueReady = false;
void worker
  .waitUntilReady()
  .then(() => {
    queueReady = true;
  })
  .catch(() => {
    console.error("Queue startup failed");
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
      worker.isPaused()
    )
      throw new Error("Not ready");
    return { status: "ready" };
  } catch {
    return reply.code(503).send({ status: "not_ready" });
  }
});
app.addHook("onClose", async () => {
  await worker.close();
  redis.disconnect();
  await pool.end();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: config.WORKER_HOST, port: config.WORKER_PORT });

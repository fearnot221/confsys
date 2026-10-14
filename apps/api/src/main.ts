import { Redis } from "ioredis";
import { loadConfig } from "@confsys/config";
import { createPool, databaseReady } from "@confsys/db";
import { buildApp } from "./app.js";
const config = loadConfig();
const pool = createPool(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  commandTimeout: 2000,
  connectTimeout: 2000,
  enableOfflineQueue: false,
});
redis.on("error", () => {}); // Readiness reports failures without leaking connection details.
const app = buildApp(
  {
    postgres: () => databaseReady(pool, "confsys_app"),
    redis: async () => {
      if ((await redis.ping()) !== "PONG") throw new Error("Redis unavailable");
    },
    worker: async () => {
      const response = await fetch(`${config.WORKER_HEALTH_URL}/health/ready`, {
        signal: AbortSignal.timeout(3000),
      });
      if (!response.ok) throw new Error("Worker unavailable");
    },
  },
  true,
);
app.addHook("onClose", async () => {
  redis.disconnect();
  await pool.end();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: config.API_HOST, port: config.API_PORT });

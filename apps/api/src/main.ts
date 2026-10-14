import {createFinanceService} from "./finance/service.js";
import {registerFinanceRoutes} from "./finance/routes.js";
import {createSubmissionService} from "./submissions/service.js";
import {registerSubmissionRoutes} from "./submissions/routes.js";
import {submissionDependencies} from "./submissions/dependencies.js";
import { createFilesService } from "./files/service.js";
import { registerFilesRoutes } from "./files/routes.js";
import { registerInvitationRoutes } from "./invitations/routes.js";
import { createInvitationService } from "./invitations/service.js";
import { registerRegistrationRoutes } from "./registration/routes.js";
import { createRegistrationService } from "./registration/service.js";
import { registerAccessRoutes } from "./access/routes.js";
import { createAccessService } from "./access/service.js";
import { registerInstanceRoute } from "./instance.js";
import { registerAuthRoutes } from "./auth/routes.js";
import { createAuthService } from "./auth/service.js";
import { createRateLimiter } from "./auth/rate-limit.js";
import { Redis } from "ioredis";
import { loadApiConfig, diagnostic } from "@confsys/config";
import { createPool, databaseReady } from "@confsys/db";
import { buildApp } from "./app.js";
import { createSiteService } from "./site/service.js";
import { registerSiteRoutes } from "./site/routes.js";
import { registerPublicRoutes } from "./site/public-routes.js";
const config = loadApiConfig();
const pool = createPool(config.DATABASE_URL);
const redis = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: 1,
  commandTimeout: 2000,
  connectTimeout: 2000,
  enableOfflineQueue: false,
});
redis.on("error", () => diagnostic("api", "rate_store_unavailable"));
redis.on("ready", () => diagnostic("api", "rate_store_ready"));
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
const site = createSiteService(pool, config);
registerInstanceRoute(app, config, site.public);
await databaseReady(pool, "confsys_app");
await registerAuthRoutes(app, {
  config,
  service: createAuthService(pool, config),
  limit: createRateLimiter(redis, config.CSRF_SIGNING_KEY),
});
registerAccessRoutes(app, config, createAccessService(pool, config));
registerSiteRoutes(app, config, site);
registerInvitationRoutes(app, config, createInvitationService(pool,config));
registerRegistrationRoutes(app, config, createRegistrationService(pool,config));
registerFilesRoutes(app,config,createFilesService(pool,config,{root:config.PRIVATE_STORAGE_ROOT,scannerHost:config.CLAMAV_HOST,scannerPort:config.CLAMAV_PORT}));
registerSubmissionRoutes(app,config,createSubmissionService(pool,config,submissionDependencies));
registerFinanceRoutes(app,config,createFinanceService(pool,config));
await registerPublicRoutes(app, config, site);
app.addHook("onClose", async () => {
  redis.disconnect();
  await pool.end();
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    void app.close();
  });
await app.listen({ host: config.API_HOST, port: config.API_PORT });

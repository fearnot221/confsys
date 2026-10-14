import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync } from "node:fs";
if (existsSync(".env")) {
  console.log(".env exists; preserved without changes");
  process.exit(0);
}
const secret = () => randomBytes(24).toString("hex");
const admin = secret(),
  migrator = secret(),
  app = secret(),
  worker = secret();
writeFileSync(
  ".env",
  `# Generated local credentials. Never commit. No production endpoints.
POSTGRES_PASSWORD=${admin}
MIGRATOR_PASSWORD=${migrator}
APP_PASSWORD=${app}
WORKER_PASSWORD=${worker}
MIGRATION_DATABASE_URL=postgresql://confsys_migrator:${migrator}@127.0.0.1:25432/confsys
DATABASE_URL=postgresql://confsys_app:${app}@127.0.0.1:25432/confsys
WORKER_DATABASE_URL=postgresql://confsys_worker:${worker}@127.0.0.1:25432/confsys
TEST_MIGRATION_DATABASE_URL=postgresql://confsys_migrator:${migrator}@127.0.0.1:25432/confsys_test
TEST_DATABASE_URL=postgresql://confsys_app:${app}@127.0.0.1:25432/confsys_test
TEST_WORKER_DATABASE_URL=postgresql://confsys_worker:${worker}@127.0.0.1:25432/confsys_test
REDIS_URL=redis://127.0.0.1:26379/0
TEST_REDIS_URL=redis://127.0.0.1:26379/1
WORKER_HEALTH_URL=http://127.0.0.1:23001
API_PORT=23000
WORKER_PORT=23001
NODE_ENV=development
`,
  { mode: 0o600, flag: "wx" },
);
console.log("Created .env with random local credentials");

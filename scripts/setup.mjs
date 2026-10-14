import { loadLocalConfig, loadIngressConfig } from "@confsys/config";
import { resolve, basename } from "node:path";
import { randomBytes } from "node:crypto";
import {
  writeFileSync,
  existsSync,
  appendFileSync,
  readFileSync,
} from "node:fs";
const file = process.env.CONFSYS_ENV_FILE ?? ".env";
const local = loadLocalConfig({
  ...process.env,
  COMPOSE_PROJECT_NAME:
    process.env.COMPOSE_PROJECT_NAME ?? basename(resolve(".")).toLowerCase(),
  APP_IMAGE: process.env.APP_IMAGE ?? "confsys:local",
});
const number = (key) => local[key];
const pgPort = number("POSTGRES_PORT"),
  redisPort = number("REDIS_PORT"),
  webPort = number("WEB_PORT"),
  smtpPort = number("SMTP_PORT"),
  mailPort = number("MAILPIT_PORT");
function authDefaults() {
  return {
    PRIVATE_STORAGE_ROOT: process.env.PRIVATE_STORAGE_ROOT ?? resolve(".private-storage"),
    CLAMAV_HOST: "127.0.0.1",
    CLAMAV_PORT: process.env.CLAMAV_PORT ?? "3310",
    PUBLIC_APP_ORIGIN:
      process.env.PUBLIC_APP_ORIGIN ?? `http://127.0.0.1:${webPort}`,
    CONFERENCE_NAME: process.env.CONFERENCE_NAME ?? "研討會",
    COMPOSE_PROJECT_NAME:
      process.env.COMPOSE_PROJECT_NAME ?? basename(resolve(".")).toLowerCase(),
    APP_IMAGE: process.env.APP_IMAGE ?? "confsys:local",
    WEB_PORT: String(webPort),
    POSTGRES_PORT: String(pgPort),
    REDIS_PORT: String(redisPort),
    MAILPIT_PORT: String(mailPort),
    MAILPIT_URL: `http://127.0.0.1:${mailPort}`,
    MAIL_KEY_VERSION: "v1",
    MAIL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    CSRF_SIGNING_KEY: randomBytes(32).toString("hex"),
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(smtpPort),
  };
}
loadIngressConfig({ PUBLIC_APP_ORIGIN: authDefaults().PUBLIC_APP_ORIGIN });
if (existsSync(file)) {
  const existing = readFileSync(file, "utf8");
  for (const [key, value] of Object.entries(authDefaults()))
    if (!new RegExp(`^${key}=`, "m").test(existing))
      appendFileSync(file, `${key}=${JSON.stringify(value)}\n`);
  console.log(".env preserved; missing auth settings added");
  process.exit(0);
}
const secret = () => randomBytes(24).toString("hex");
const admin = secret(),
  migrator = secret(),
  app = secret(),
  worker = secret();
writeFileSync(
  file,
  `# Generated local credentials. Never commit. No production endpoints.
POSTGRES_PASSWORD=${admin}
MIGRATOR_PASSWORD=${migrator}
APP_PASSWORD=${app}
WORKER_PASSWORD=${worker}
MIGRATION_DATABASE_URL=postgresql://confsys_migrator:${migrator}@127.0.0.1:${pgPort}/confsys
DATABASE_URL=postgresql://confsys_app:${app}@127.0.0.1:${pgPort}/confsys
WORKER_DATABASE_URL=postgresql://confsys_worker:${worker}@127.0.0.1:${pgPort}/confsys
TEST_MIGRATION_DATABASE_URL=postgresql://confsys_migrator:${migrator}@127.0.0.1:${pgPort}/confsys_test
TEST_DATABASE_URL=postgresql://confsys_app:${app}@127.0.0.1:${pgPort}/confsys_test
TEST_WORKER_DATABASE_URL=postgresql://confsys_worker:${worker}@127.0.0.1:${pgPort}/confsys_test
REDIS_URL=redis://127.0.0.1:${redisPort}/0
TEST_REDIS_URL=redis://127.0.0.1:${redisPort}/1
WORKER_HEALTH_URL=http://127.0.0.1:${number("WORKER_PORT")}
API_PORT=${number("API_PORT")}
WORKER_PORT=${number("WORKER_PORT")}
NODE_ENV=development
`,
  { mode: 0o600, flag: "wx" },
);
for (const [key, value] of Object.entries(authDefaults()))
  appendFileSync(file, `${key}=${JSON.stringify(value)}\n`);
console.log("Created .env with random local credentials");

import { resolve } from "node:path";
import { z } from "zod";
const url = (protocols: string[]) =>
  z
    .url()
    .refine(
      (value) =>
        URL.canParse(value) && protocols.includes(new URL(value).protocol),
    );
const database = url(["postgres:", "postgresql:"]);
const redis = url(["redis:", "rediss:"]);
const port = z.coerce.number().int().min(1).max(65535);
const seconds = z.coerce.number().int().min(60).max(2592000);
const base = {
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
};
const mailKey = {
  MAIL_KEY_VERSION: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/),
  MAIL_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/),
};
const instance = {
  CONFERENCE_NAME: z
    .string()
    .trim()
    .min(1)
    .max(160)
    .refine((value) =>
      [...value].every(
        (char) => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127,
      ),
    )
    .default("研討會"),
};
export function isLocalHostname(host: string) {
  return (
    ["localhost", "127.0.0.1", "[::1]"].includes(host) ||
    /^[a-z0-9-]+\.localhost$/.test(host)
  );
}
const apiSchema = z.object({
  ...instance,
  ...base,
  ...mailKey,
  PRIVATE_STORAGE_ROOT: z.string().min(1).refine(v => v.startsWith("/")).default(() => resolve(".private-storage")),
  CLAMAV_HOST: z.enum(["127.0.0.1", "localhost", "clamav"]).default("127.0.0.1"),
  CLAMAV_PORT: port.default(3310),
  DATABASE_URL: database,
  REDIS_URL: redis,
  WORKER_HEALTH_URL: url(["http:", "https:"]),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: port.default(23000),
  PUBLIC_APP_ORIGIN: z.url(),
  QR_SIGNING_KEY: z.string().regex(/^[a-f0-9]{64}$/),
  CSRF_SIGNING_KEY: z.string().regex(/^[a-f0-9]{64}$/),
  SESSION_IDLE_SECONDS: seconds.default(1800),
  SESSION_ABSOLUTE_SECONDS: seconds.default(43200),
  VERIFICATION_TTL_SECONDS: seconds.default(86400),
  RESET_TTL_SECONDS: seconds.default(1800),
});
function parse<T>(schema: z.ZodType<T>, env: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid environment fields: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  return result.data;
}
export function loadIngressConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = parse(z.object({ ...base, PUBLIC_APP_ORIGIN: z.url() }), env);
  const origin = new URL(config.PUBLIC_APP_ORIGIN);
  if (
    origin.origin !== config.PUBLIC_APP_ORIGIN ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        config.NODE_ENV !== "production" &&
        origin.protocol === "http:" &&
        isLocalHostname(origin.hostname)
      ))
  )
    throw new Error("Invalid environment fields: PUBLIC_APP_ORIGIN");
  return config;
}
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = parse(apiSchema, env);
  loadIngressConfig(env);
  if (config.SESSION_IDLE_SECONDS > config.SESSION_ABSOLUTE_SECONDS)
    throw new Error("Invalid environment fields: SESSION_IDLE_SECONDS");
  return config;
}
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env) {
  return parse(
    z.object({
      ...base,
      ...instance,
      ...mailKey,
      QR_SIGNING_KEY: z.string().regex(/^[a-f0-9]{64}$/),
      WORKER_DATABASE_URL: database,
      REDIS_URL: redis,
      WORKER_HOST: z.string().default("127.0.0.1"),
      WORKER_PORT: port.default(23001),
      // Capture-only transport. There is intentionally no production SMTP credential option.
      SMTP_HOST: z
        .enum(["127.0.0.1", "localhost", "mailpit"])
        .default("127.0.0.1"),
      SMTP_PORT: port.default(21025),
    }),
    env,
  );
}
export function loadMigrationConfig(env: NodeJS.ProcessEnv = process.env) {
  return parse(z.object({ MIGRATION_DATABASE_URL: database }), env);
}
// Compatibility for the Phase 0 validation callers; runtime uses explicit loaders.
export const loadConfig = loadApiConfig;
export type ApiConfig = ReturnType<typeof loadApiConfig>;
export type WorkerConfig = ReturnType<typeof loadWorkerConfig>;
export function diagnostic(
  service: string,
  event: string,
  context: { requestId?: string; eventId?: string; attempt?: number } = {},
) {
  console.error(JSON.stringify({ service, event, ...context }));
}
export function redisOptions(url: string) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: decodeURIComponent(parsed.username) || undefined,
    password: decodeURIComponent(parsed.password) || undefined,
    db: Number(parsed.pathname.slice(1) || 0),
    ...(parsed.protocol === "rediss:" ? { tls: {} } : {}),
  };
}

// Local tooling only; never serialized by the API or passed wholesale to services.
export function loadLocalConfig(env: NodeJS.ProcessEnv = process.env) {
  return parse(
    z.object({
      COMPOSE_PROJECT_NAME: z.string().regex(/^[a-z0-9][a-z0-9_-]+$/),
      APP_IMAGE: z
        .string()
        .regex(
          /^[a-z0-9][a-z0-9/._-]*(?::[a-zA-Z0-9._-]+|@sha256:[a-f0-9]{64})$/,
        ),
      WEB_PORT: port.default(25173),
      POSTGRES_PORT: port.default(25432),
      REDIS_PORT: port.default(26379),
      MAILPIT_PORT: port.default(28025),
      SMTP_PORT: port.default(21025),
      API_PORT: port.default(23000),
      WORKER_PORT: port.default(23001),
      MAILPIT_URL: url(["http:"])
        .refine(
          (value) =>
            URL.canParse(value) && isLocalHostname(new URL(value).hostname),
        )
        .optional(),
    }),
    env,
  );
}

export function loadBootstrapConfig(env: NodeJS.ProcessEnv = process.env) {
  return {
    ...loadMigrationConfig(env),
    ...loadIngressConfig(env),
    ...parse(z.object(instance), env),
  };
}

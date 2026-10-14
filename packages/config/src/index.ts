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
const apiSchema = z.object({
  ...base,
  ...mailKey,
  DATABASE_URL: database,
  REDIS_URL: redis,
  WORKER_HEALTH_URL: url(["http:", "https:"]),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: port.default(23000),
  PUBLIC_APP_ORIGIN: z.url(),
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
export function loadApiConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = parse(apiSchema, env);
  const origin = new URL(config.PUBLIC_APP_ORIGIN);
  if (
    origin.origin !== config.PUBLIC_APP_ORIGIN ||
    origin.username ||
    origin.password ||
    (origin.protocol !== "https:" &&
      !(
        config.NODE_ENV !== "production" &&
        origin.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)
      ))
  )
    throw new Error("Invalid environment fields: PUBLIC_APP_ORIGIN");
  if (config.SESSION_IDLE_SECONDS > config.SESSION_ABSOLUTE_SECONDS)
    throw new Error("Invalid environment fields: SESSION_IDLE_SECONDS");
  return config;
}
export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env) {
  return parse(
    z.object({
      ...base,
      ...mailKey,
      WORKER_DATABASE_URL: database,
      REDIS_URL: redis,
      WORKER_HOST: z.string().default("127.0.0.1"),
      WORKER_PORT: port.default(23001),
      // Capture-only transport. There is intentionally no production SMTP credential option.
      SMTP_HOST: z
        .enum(["127.0.0.1", "localhost", "mailpit"])
        .default("127.0.0.1"),
      SMTP_PORT: z.coerce
        .number()
        .refine((n) => n === 1025 || n === 21025)
        .default(21025),
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

import { z } from "zod";
const schema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  API_HOST: z.string().default("127.0.0.1"),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(23000),
  WORKER_HOST: z.string().default("127.0.0.1"),
  WORKER_PORT: z.coerce.number().int().min(1).max(65535).default(23001),
  DATABASE_URL: z.url(),
  WORKER_DATABASE_URL: z.url(),
  REDIS_URL: z.url(),
  WORKER_HEALTH_URL: z.url(),
});
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const result = schema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid environment fields: ${result.error.issues.map((i) => i.path.join(".")).join(", ")}`,
    );
  for (const field of ["DATABASE_URL", "WORKER_DATABASE_URL"] as const) {
    if (
      !["postgres:", "postgresql:"].includes(
        new URL(result.data[field]).protocol,
      )
    )
      throw new Error(`Invalid protocol: ${field}`);
  }
  if (!["redis:", "rediss:"].includes(new URL(result.data.REDIS_URL).protocol))
    throw new Error("Invalid protocol: REDIS_URL");
  if (
    !["http:", "https:"].includes(
      new URL(result.data.WORKER_HEALTH_URL).protocol,
    )
  )
    throw new Error("Invalid protocol: WORKER_HEALTH_URL");
  return result.data;
}
export type Config = ReturnType<typeof loadConfig>;
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

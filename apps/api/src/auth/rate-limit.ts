import { createHmac } from "node:crypto";
import type { Redis } from "ioredis";
import { AuthError } from "./errors.js";
// Atomic, expiring counters. No permanent account lockout; keys contain keyed hashes.
const script = `local blocked=0
for i,key in ipairs(KEYS) do
 local n=redis.call('INCR',key)
 if n==1 then redis.call('EXPIRE',key,ARGV[1]) end
 if n>tonumber(ARGV[i+1]) then blocked=1 end
end
return blocked`;
export function createRateLimiter(
  redis: Redis,
  key: string,
  namespace = "auth-limit",
) {
  return async (operation: string, source: string, subject?: string) => {
    const hash = (value: string) =>
      createHmac("sha256", key).update(value).digest("hex");
    const keys = [`${namespace}:source:${hash(source)}`];
    if (subject) keys.push(`${namespace}:${operation}:${hash(subject)}`);
    let blocked: unknown;
    try {
      blocked = await redis.eval(
        script,
        keys.length,
        ...keys,
        900,
        100,
        operation === "login" ? 10 : 5,
      );
    } catch {
      throw new AuthError("SERVICE_UNAVAILABLE");
    }
    if (blocked === 1) throw new AuthError("RATE_LIMITED");
  };
}
export type RateLimiter = ReturnType<typeof createRateLimiter>;

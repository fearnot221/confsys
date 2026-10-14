import type { Writable } from "node:stream";
import { AuthError } from "./auth/errors.js";
import Fastify, { LogController, type FastifyError } from "fastify";
import { randomUUID } from "node:crypto";
import {
  jsonSchemas,
  routes,
  type Readiness,
  type ErrorCode,
  errorStatuses,
} from "@confsys/contracts";
const httpErrors: Partial<Record<number, ErrorCode>> = {
  400: "INVALID_REQUEST",
  401: "SESSION_EXPIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "REQUEST_TOO_LARGE",
  415: "UNSUPPORTED_MEDIA_TYPE",
  429: "RATE_LIMITED",
  503: "SERVICE_UNAVAILABLE",
};
function publicErrorCode(error: FastifyError): ErrorCode {
  if (error instanceof AuthError) return error.code;
  if (error.code?.startsWith("FST_CSRF")) return "CSRF_REJECTED";
  if (error.validation) return "INVALID_REQUEST";
  const mapped = error.statusCode && httpErrors[error.statusCode];
  if (mapped) return mapped;
  if (error.code && /^(08|53|57|ECONN|ETIMEDOUT)/.test(error.code))
    return "SERVICE_UNAVAILABLE";
  return "INTERNAL_ERROR";
}
export type Probe = () => Promise<void>;
export function buildApp(
  probes: { postgres: Probe; redis: Probe; worker: Probe },
  logging: boolean | Writable = false,
) {
  const app = Fastify({
    logger: logging
      ? {
          ...(typeof logging === "object" ? { stream: logging } : {}),
          redact: [
            "req.headers.authorization",
            "req.headers.cookie",
            "res.headers.set-cookie",
          ],
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
    genReqId: () => randomUUID(),
    requestIdHeader: false,
    bodyLimit: 16384,
    requestTimeout: 10000,
  });
  app.addHook("onSend", async (request, reply) => {
    reply
      .header("x-request-id", request.id)
      .header("cache-control", "no-store")
      .header("x-content-type-options", "nosniff")
      .header("referrer-policy", "no-referrer");
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info(
      {
        route: request.routeOptions.url ?? "unmatched",
        method: request.method,
        statusCode: reply.statusCode,
      },
      "request completed",
    );
  });
  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: "NOT_FOUND",
        message: "Route not found",
        requestId: request.id,
      },
    }),
  );
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const code = publicErrorCode(error);
    request.log.error(
      { service: "api", event: "request_failed", code, requestId: request.id },
      "request failed",
    );
    if (code === "RATE_LIMITED") reply.header("retry-after", "900");
    return reply
      .code(errorStatuses[code])
      .send({ error: { code, message: code, requestId: request.id } });
  });
  app.get(
    routes.live,
    { schema: { response: { 200: jsonSchemas.live } } },
    async () => ({ status: "alive" as const }),
  );
  app.get(
    routes.ready,
    {
      schema: { response: { 200: jsonSchemas.ready, 503: jsonSchemas.ready } },
    },
    async (_request, reply) => {
      const results = await Promise.allSettled([
        probes.postgres(),
        probes.redis(),
        probes.worker(),
      ]);
      const statuses = results.map((r) =>
        r.status === "fulfilled" ? ("up" as const) : ("down" as const),
      );
      const ready = statuses.every((s) => s === "up");
      const body: Readiness = {
        status: ready ? "ready" : "not_ready",
        dependencies: {
          postgres: statuses[0]!,
          redis: statuses[1]!,
          worker: statuses[2]!,
        },
      };
      return reply.code(ready ? 200 : 503).send(body);
    },
  );
  return app;
}

import Fastify, { LogController, type FastifyError } from "fastify";
import { randomUUID } from "node:crypto";
import { jsonSchemas, routes, type Readiness } from "@confsys/contracts";
export type Probe = () => Promise<void>;
export function buildApp(
  probes: { postgres: Probe; redis: Probe; worker: Probe },
  logging = false,
) {
  const app = Fastify({
    logger: logging
      ? {
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
      .header("x-content-type-options", "nosniff");
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
    reply
      .code(404)
      .send({
        error: {
          code: "NOT_FOUND",
          message: "Route not found",
          requestId: request.id,
        },
      }),
  );
  app.setErrorHandler<FastifyError>((error, request, reply) => {
    const invalid =
      !!error.validation ||
      (error.statusCode !== undefined &&
        error.statusCode >= 400 &&
        error.statusCode < 500);
    request.log.error(
      { code: invalid ? "INVALID_REQUEST" : "INTERNAL_ERROR" },
      "request failed",
    );
    return reply
      .code(invalid ? 400 : 500)
      .send({
        error: {
          code: invalid ? "INVALID_REQUEST" : "INTERNAL_ERROR",
          message: invalid ? "Invalid request" : "Internal error",
          requestId: request.id,
        },
      });
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

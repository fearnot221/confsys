import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { presenterChangeEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { cookiePolicy } from "../auth/routes.js";
import { AuthError } from "../auth/errors.js";
import type { createPresenterChangesService } from "./service.js";
export function registerPresenterChangesRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createPresenterChangesService>,
) {
  for (const [name, spec] of Object.entries(presenterChangeEndpoints))
    app.route({
      method: spec.method.toUpperCase() as "GET" | "POST",
      url: spec.path,
      onRequest:
        spec.method === "post"
          ? [
              async (req) => {
                if (req.headers.origin !== config.PUBLIC_APP_ORIGIN)
                  throw new AuthError("CSRF_REJECTED");
              },
              app.csrfProtection,
            ]
          : [],
      schema: { response: { 200: z.toJSONSchema(spec.output) } },
      handler: async (req, reply) => {
        const data = spec.input.safeParse(
          spec.method === "post" ? req.body : req.query,
        );
        if (!data.success) throw new AuthError("INVALID_REQUEST");
        reply.header("cache-control", "private, no-store");
        const raw = req.cookies[cookiePolicy(config).name];
        if (name === "presenterChanges") {
          const query = presenterChangeEndpoints.presenterChanges.input.parse(
            data.data,
          );
          return service.list(raw, query.scope, query.offset);
        }
        if (name === "presenterChangeCreate")
          return service.create(raw, data.data, req.id);
        if (name === "presenterChangeRespond")
          return service.respond(raw, data.data, req.id);
        if (name === "presenterChangeCancel")
          return service.cancel(raw, data.data, req.id);
        return service.decide(raw, data.data, req.id);
      },
    });
}

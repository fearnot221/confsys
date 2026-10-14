import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { reportingEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { cookiePolicy } from "../auth/routes.js";
import type { createReportingService } from "./service.js";
export function registerReportingRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createReportingService>,
) {
  for (const [name, spec] of Object.entries(reportingEndpoints))
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
      handler: async (req) => {
        const input = spec.input.safeParse(
          spec.method === "post" ? req.body : req.query,
        );
        if (!input.success) throw new AuthError("INVALID_REQUEST");
        const raw = req.cookies[cookiePolicy(config).name];
        switch (name) {
          case "notificationList":
            return service.list(raw, input.data);
          case "notificationRead":
            return service.read(raw, input.data);
          case "reportingStats":
            return service.stats(raw);
          case "reportingExport":
            return service.export(raw, input.data, req.id);
          case "authorPreview":
            return service.preview(raw, input.data, req.id);
        }
      },
    });
}

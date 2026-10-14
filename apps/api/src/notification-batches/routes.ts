import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { notificationBatchEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { cookiePolicy } from "../auth/routes.js";
import type { createNotificationBatchService } from "./service.js";
export function registerNotificationBatchRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createNotificationBatchService>,
) {
  for (const [name, spec] of Object.entries(notificationBatchEndpoints))
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
        reply.header("x-robots-tag", "noindex, nofollow");
        const input = spec.input.safeParse(
          spec.method === "post" ? req.body : req.query,
        );
        if (!input.success) throw new AuthError("INVALID_REQUEST");
        const raw = req.cookies[cookiePolicy(config).name];
        switch (name) {
          case "notificationAudiencePreview":
            return service.preview(raw, input.data);
          case "notificationTemplateList":
            return service.templates(raw, input.data);
          case "notificationTemplateSave":
            return service.saveTemplate(raw, input.data, req.id);
          case "notificationBatchDeliveries":
            return service.deliveries(raw, input.data);
          case "notificationBatchList":
            return service.list(raw, input.data);
          case "notificationBatchCreate":
            return service.create(raw, input.data, req.id);
          case "notificationBatchRetry":
            return service.retry(raw, input.data, req.id);
          case "notificationBatchCancel":
            return service.cancel(raw, input.data, req.id);
        }
      },
    });
}

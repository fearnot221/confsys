import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { financeReminderEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { cookiePolicy } from "../auth/routes.js";
import type { createFinanceReminderService } from "./service.js";
export function registerFinanceReminderRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createFinanceReminderService>,
) {
  for (const [name, spec] of Object.entries(financeReminderEndpoints))
    app.route({
      method: spec.method.toUpperCase() as "GET" | "POST",
      url: spec.path,
      bodyLimit: 32768,
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
        const raw = req.cookies[cookiePolicy(config).name],
          input = spec.method === "post" ? req.body : req.query;
        if (!spec.input.safeParse(input).success)
          throw new AuthError("INVALID_REQUEST");
        switch (name) {
          case "financeReminderPreview":
            return service.preview(raw, input);
          case "financeReminderList":
            return service.list(raw, input);
          case "financeReminderCreate":
            return service.create(raw, input, req.id);
          case "financeReminderCancel":
            return service.cancel(raw, input, req.id);
        }
      },
    });
}

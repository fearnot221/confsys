import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { invitationEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { cookiePolicy } from "../auth/routes.js";
import type { createInvitationService } from "./service.js";
export function registerInvitationRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createInvitationService>,
) {
  for (const [name, spec] of Object.entries(invitationEndpoints))
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
        const parsed = spec.input.safeParse(
          spec.method === "post" ? req.body : req.query,
        );
        if (!parsed.success) throw new AuthError("INVALID_REQUEST");
        const raw = req.cookies[cookiePolicy(config).name];
        switch (name) {
          case "list":
            return service.list(raw, parsed.data);
          case "create":
            return service.create(raw, parsed.data, req.id);
          case "accept":
            return service.accept(raw, parsed.data, req.id);
          case "revoke": {
            const params = z
              .strictObject({ id: z.uuid() })
              .safeParse(req.params);
            if (!params.success) throw new AuthError("INVALID_REQUEST");
            return service.revoke(raw, params.data.id, parsed.data, req.id);
          }
        }
      },
    });
}

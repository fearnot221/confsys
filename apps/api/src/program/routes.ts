import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { programEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { cookiePolicy } from "../auth/routes.js";
import type { createProgramService } from "./service.js";
export function registerProgramRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createProgramService>,
) {
  for (const [name, spec] of Object.entries(programEndpoints))
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
      handler: async (req, reply) => {
        if (name !== "programPublic")
          reply.header("x-robots-tag", "noindex, nofollow");
        if ("input" in spec && !spec.input.safeParse(req.body).success)
          throw new AuthError("INVALID_REQUEST");
        const raw = req.cookies[cookiePolicy(config).name];
        switch (name) {
          case "programPublic":
            return service.public();
          case "programDraft":
            return service.draft(raw);
          case "programRoom":
            return service.room(raw, req.body, req.id);
          case "programBlocked":
            return service.blocked(raw, req.body, req.id);
          case "programSession":
            return service.session(raw, req.body, req.id);
          case "programSlot":
            return service.slot(raw, req.body, req.id);
          case "programRemove":
            return service.remove(raw, req.body, req.id);
          case "programPublish":
            return service.publish(raw, req.body, req.id);
        }
      },
    });
}

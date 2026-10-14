import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { submissionEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { cookiePolicy } from "../auth/routes.js";
import type { createSubmissionService } from "./service.js";
export function registerSubmissionRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createSubmissionService>,
) {
  for (const [name, spec] of Object.entries(submissionEndpoints))
    app.route({
      method: spec.method.toUpperCase() as "GET" | "POST",
      url: spec.path,
      bodyLimit: 131072,
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
        if (
          "input" in spec &&
          !spec.input.safeParse(spec.method === "post" ? req.body : req.query)
            .success
        )
          throw new AuthError("INVALID_REQUEST");
        const raw = req.cookies[cookiePolicy(config).name];
        switch (name) {
          case "submissionConfig":
            return service.config(raw);
          case "submissionConfigure":
            return service.configure(raw, req.body, req.id);
          case "submissionList": {
            const q = submissionEndpoints.submissionList.input.parse(req.query);
            return service.list(raw, q.scope, q.offset);
          }
          case "submissionDetail": {
            const q = submissionEndpoints.submissionDetail.input.parse(
              req.query,
            );
            return service.detail(raw, q.id, q.scope, q.revisionOffset);
          }
          case "submissionSave":
            return service.save(raw, req.body, req.id);
          case "submissionTransition":
            return service.transition(raw, req.body, req.id);
        }
      },
    });
}

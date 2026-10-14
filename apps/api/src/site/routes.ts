import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { siteEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { cookiePolicy } from "../auth/routes.js";
import type { createSiteService } from "./service.js";
export function registerSiteRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createSiteService>,
) {
  for (const [name, spec] of Object.entries(siteEndpoints))
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
        const raw = req.cookies[cookiePolicy(config).name];
        if (name !== "sitePublic")
          reply.header("x-robots-tag", "noindex, nofollow");
        if (
          "input" in spec &&
          !spec.input.safeParse(spec.method === "post" ? req.body : req.query)
            .success
        )
          throw new AuthError("INVALID_REQUEST");
        switch (name) {
          case "sitePublic":
            return service.public();
          case "siteDraft":
            return service.draft(raw);
          case "sitePreview":
            return service.preview(
              raw,
              siteEndpoints.sitePreview.input.parse(req.query).version,
            );
          case "siteHistory":
            return service.history(
              raw,
              siteEndpoints.siteHistory.input.parse(req.query).offset,
            );
          case "siteSave":
            return service.save(raw, req.body, req.id);
          case "sitePublish":
            return service.publish(raw, req.body, req.id);
          case "siteRestore":
            return service.restore(raw, req.body, req.id);
        }
      },
    });
}

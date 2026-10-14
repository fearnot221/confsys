import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { badgeTemplateEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { cookiePolicy } from "../auth/routes.js";
import { AuthError } from "../auth/errors.js";
import type { createBadgeTemplateService } from "./service.js";
export function registerBadgeTemplateRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createBadgeTemplateService>,
) {
  for (const spec of Object.values(badgeTemplateEndpoints))
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
        const data = spec.input.safeParse(
          spec.method === "post" ? req.body : req.query,
        );
        if (!data.success) throw new AuthError("INVALID_REQUEST");
        const raw = req.cookies[cookiePolicy(config).name];
        return spec.method === "post"
          ? service.save(raw, data.data, req.id)
          : service.get(raw);
      },
    });
  app.get("/api/badge-template/preview", async (req, reply) =>
    reply
      .type("application/pdf")
      .header("cache-control", "private, no-store")
      .header(
        "content-disposition",
        'attachment; filename="badge-template-preview.pdf"',
      )
      .header("x-robots-tag", "noindex, nofollow")
      .send(await service.preview(req.cookies[cookiePolicy(config).name])),
  );
}

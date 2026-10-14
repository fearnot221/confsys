import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { exportJobEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { cookiePolicy } from "../auth/routes.js";
import type { createExportJobsService } from "./service.js";
export function registerExportJobRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createExportJobsService>,
) {
  for (const [name, spec] of Object.entries(exportJobEndpoints))
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
          case "exportJobList":
            return service.list(raw, input.data);
          case "exportJobCreate":
            return service.create(raw, input.data, req.id);
        }
      },
    });
  app.get("/api/reporting/export-jobs/:id/download", async (req, reply) => {
    const parsed = z.strictObject({ id: z.uuid() }).safeParse(req.params);
    if (!parsed.success) throw new AuthError("INVALID_REQUEST");
    const file = await service.download(
      req.cookies[cookiePolicy(config).name],
      parsed.data.id,
      req.id,
    );
    return reply
      .header("Cache-Control", "no-store")
      .header("Content-Disposition", `attachment; filename="${file.name}"`)
      .header("X-Content-Type-Options", "nosniff")
      .type("text/csv; charset=utf-8")
      .send(file.bytes);
  });
}

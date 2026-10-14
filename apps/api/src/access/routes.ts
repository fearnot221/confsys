import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { accessEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { cookiePolicy } from "../auth/routes.js";
import type { createAccessService } from "./service.js";
export function registerAccessRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createAccessService>,
) {
  for (const [name, spec] of Object.entries(accessEndpoints)) {
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
        const raw = req.cookies[cookiePolicy(config).name];
        const parsed =
          "input" in spec
            ? spec.input.safeParse(
                spec.method === "post" ? req.body : req.query,
              )
            : undefined;
        if (parsed && !parsed.success) throw new AuthError("INVALID_REQUEST");
        const params = z.strictObject({ id: z.uuid() }).safeParse(req.params);
        if ((name === "detail" || name === "mutate") && !params.success)
          throw new AuthError("INVALID_REQUEST");
        switch (name) {
          case "directory":
            return service.directory(raw, parsed?.data);
          case "roles":
            return service.roles(raw);
          case "audit":
            return service.audit(raw, parsed?.data);
          case "detail":
            return service.detail(raw, params.success ? params.data.id : "");
          case "mutate":
            return service.mutate(
              raw,
              params.success ? params.data.id : "",
              parsed?.data,
              req.id,
            );
        }
      },
    });
  }
}

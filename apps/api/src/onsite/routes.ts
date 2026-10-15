import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { onsiteEndpoints, onsiteListInput } from "@confsys/contracts";
import { z } from "zod";
import { cookiePolicy } from "../auth/routes.js";
import { AuthError } from "../auth/errors.js";
import type { createOnsiteService } from "./service.js";
export function registerOnsiteRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createOnsiteService>,
) {
  for (const [name, spec] of Object.entries(onsiteEndpoints))
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
          case "onsitePass":
            return service.pass(raw, parsed.data, req.id);
          case "onsiteLookup":
            return service.lookup(raw, parsed.data);
          case "onsiteCheckin":
            return service.checkin(raw, parsed.data, req.id);
          case "onsiteRedeem":
            return service.redeem(raw, parsed.data, req.id);
          case "onsiteUndo":
            return service.undo(raw, parsed.data, req.id);
          case "onsiteDirectory": {
            const data = onsiteListInput.parse(parsed.data);
            return service.directory(raw, data.search, data.offset);
          }
        }
      },
    });
  app.get("/api/onsite/qr/:id", async (req, reply) => {
    const params = z.strictObject({ id: z.uuid() }).safeParse(req.params);
    if (!params.success) throw new AuthError("INVALID_REQUEST");
    const bytes = await service.qr(
      req.cookies[cookiePolicy(config).name],
      params.data.id,
    );
    return reply
      .type("image/png")
      .header("cache-control", "private, no-store")
      .header("x-robots-tag", "noindex, nofollow")
      .send(bytes);
  });
}

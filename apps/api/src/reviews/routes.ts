import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { reviewEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { cookiePolicy } from "../auth/routes.js";
import type { createReviewService } from "./service.js";
export function registerReviewRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createReviewService>,
  download?: (
    raw: string | undefined,
    assignmentId: string,
    fileId: string,
    requestId: string,
  ) => Promise<{ bytes: Buffer; mediaType: string; name: string }>,
) {
  for (const [name, spec] of Object.entries(reviewEndpoints))
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
          case "reviewScreen":
            return service.screen(raw, input.data, req.id);
          case "reviewRemind":
            return service.remind(raw, input.data, req.id);
          case "reviewBoard":
            return service.board(raw, input.data);
          case "reviewAssigned":
            return service.assigned(raw, input.data);
          case "reviewForm":
            return service.configure(raw, input.data, req.id);
          case "reviewScope":
            return service.scope(raw, input.data, req.id);
          case "reviewConflict":
            return service.conflict(raw, input.data, req.id);
          case "reviewAssign":
            return service.assign(raw, input.data, req.id);
          case "reviewAction":
            return service.action(raw, input.data, req.id);
          case "reviewDecide":
            return service.decide(raw, input.data, req.id);
          case "reviewPublish":
            return service.publish(raw, input.data, req.id);
          case "reviewAuthorResults":
            return service.authorResults(raw, input.data);
        }
      },
    });
  if (download)
    app.get(
      "/api/reviews/assignments/:assignmentId/files/:fileId",
      async (req, reply) => {
        const input = z
          .strictObject({ assignmentId: z.uuid(), fileId: z.uuid() })
          .safeParse(req.params);
        if (!input.success) throw new AuthError("INVALID_REQUEST");
        const file = await download(
          req.cookies[cookiePolicy(config).name],
          input.data.assignmentId,
          input.data.fileId,
          req.id,
        );
        return reply
          .header("content-type", file.mediaType)
          .header("content-disposition", `attachment; filename="${file.name}"`)
          .header("cache-control", "no-store")
          .header("x-content-type-options", "nosniff")
          .send(file.bytes);
      },
    );
}

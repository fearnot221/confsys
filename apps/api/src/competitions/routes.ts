import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { competitionEndpoints } from "@confsys/contracts";
import { z } from "zod";
import { AuthError } from "../auth/errors.js";
import { cookiePolicy } from "../auth/routes.js";
import type { createCompetitionService } from "./service.js";
export function registerCompetitionRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createCompetitionService>,
) {
  for (const [name, spec] of Object.entries(competitionEndpoints))
    app.route({
      method: spec.method.toUpperCase() as "GET" | "POST",
      url: spec.path,
      bodyLimit: 65536,
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
        if (name !== "competitionPublic")
          reply.header("x-robots-tag", "noindex, nofollow");
        const raw = req.cookies[cookiePolicy(config).name],
          input = spec.method === "get" ? req.query : req.body;
        if ("input" in spec && !spec.input.safeParse(input).success)
          throw new AuthError("INVALID_REQUEST");
        switch (name) {
          case "competitionPublic":
            return service.public();
          case "competitionCatalog":
            return service.catalog(
              raw,
              competitionEndpoints.competitionCatalog.input.parse(input).offset,
            );
          case "competitionAdmin": {
            const d = competitionEndpoints.competitionAdmin.input.parse(input);
            return service.admin(raw, d.competitionId ?? null, d.offset);
          }
          case "competitionJudging":
            return service.judging(
              raw,
              competitionEndpoints.competitionJudging.input.parse(input).offset,
            );
          case "competitionConfigure":
            return service.configure(raw, input, req.id);
          case "competitionEnroll":
            return service.enroll(raw, input, req.id);
          case "competitionEntry":
            return service.entry(raw, input, req.id);
          case "competitionAssign":
            return service.assign(raw, input, req.id);
          case "competitionCancel":
            return service.cancel(raw, input, req.id);
          case "competitionConflict":
            return service.conflict(raw, input, req.id);
          case "competitionScore":
            return service.score(raw, input, req.id);
          case "competitionAwards":
            return service.awards(raw, input, req.id);
          case "competitionPublish":
            return service.publish(raw, input, req.id);
        }
      },
    });
}

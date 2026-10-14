import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { publicInstanceSchema, routes } from "@confsys/contracts";
import { AuthError } from "./auth/errors.js";
import { z } from "zod";
export function registerInstanceRoute(
  app: FastifyInstance,
  config: ApiConfig,
  branding: () => Promise<{ conferenceName: string }>,
) {
  app.addHook("onRequest", async (request) => {
    if (
      !request.url.startsWith("/api/health/") &&
      request.headers.host !== new URL(config.PUBLIC_APP_ORIGIN).host
    )
      throw new AuthError("FORBIDDEN");
  });
  app.get(
    routes.instance,
    { schema: { response: { 200: z.toJSONSchema(publicInstanceSchema) } } },
    async () => ({ conferenceName: (await branding()).conferenceName }),
  );
}

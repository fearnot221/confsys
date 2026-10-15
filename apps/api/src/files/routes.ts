import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import {
  fileAssetSchema,
  fileListInput,
  fileListSchema,
  fileUploadInput,
} from "@confsys/contracts";
import { z } from "zod";
import { cookiePolicy } from "../auth/routes.js";
import { AuthError } from "../auth/errors.js";
import type { createFilesService } from "./service.js";
export function registerFilesRoutes(
  app: FastifyInstance,
  config: ApiConfig,
  service: ReturnType<typeof createFilesService>,
) {
  const csrf = [
    async (req: { headers: { origin?: string | undefined } }) => {
      if (req.headers.origin !== config.PUBLIC_APP_ORIGIN)
        throw new AuthError("CSRF_REJECTED");
    },
    app.csrfProtection,
  ];
  const id = (params: unknown) => {
    const result = z.strictObject({ id: z.uuid() }).safeParse(params);
    if (!result.success) throw new AuthError("INVALID_REQUEST");
    return result.data.id;
  };
  app.get(
    "/api/files",
    { schema: { response: { 200: z.toJSONSchema(fileListSchema) } } },
    async (req) => {
      const input = fileListInput.safeParse(req.query);
      if (!input.success) throw new AuthError("INVALID_REQUEST");
      return service.list(req.cookies[cookiePolicy(config).name], input.data);
    },
  );
  app.post(
    "/api/files",
    {
      bodyLimit: 11_185_500,
      onRequest: csrf,
      schema: { response: { 200: z.toJSONSchema(fileAssetSchema) } },
    },
    async (req) => {
      const input = fileUploadInput.safeParse(req.body);
      if (!input.success) throw new AuthError("INVALID_REQUEST");
      return service.upload(
        req.cookies[cookiePolicy(config).name],
        input.data,
        req.id,
      );
    },
  );
  app.post(
    "/api/files/:id/scan",
    {
      onRequest: csrf,
      schema: { response: { 200: z.toJSONSchema(fileAssetSchema) } },
    },
    async (req) => {
      if (!z.strictObject({}).safeParse(req.body).success)
        throw new AuthError("INVALID_REQUEST");
      return service.retry(
        req.cookies[cookiePolicy(config).name],
        id(req.params),
        req.id,
      );
    },
  );
  app.get("/api/files/:id/download", async (req, reply) => {
    const result = await service.download(
      req.cookies[cookiePolicy(config).name],
      id(req.params),
      req.id,
    );
    return reply
      .header("content-type", result.mediaType)
      .header(
        "content-disposition",
        `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(result.name)}`,
      )
      .header("content-security-policy", "sandbox")
      .header("x-robots-tag", "noindex, nofollow")
      .send(result.bytes);
  });
  app.get("/api/media/:id", async (req, reply) => {
    const result = await service.publicMedia(id(req.params));
    return reply
      .header("content-type", result.mediaType)
      .header("content-disposition", "inline")
      .header("content-security-policy", "sandbox")
      .send(result.bytes);
  });
}

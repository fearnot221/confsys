import { z } from "zod";
export const dependencyStatus = z.enum(["up", "down"]);
export const readinessSchema = z.strictObject({
  status: z.enum(["ready", "not_ready"]),
  dependencies: z.strictObject({
    postgres: dependencyStatus,
    redis: dependencyStatus,
    worker: dependencyStatus,
  }),
});
export type Readiness = z.infer<typeof readinessSchema>;
export const liveSchema = z.strictObject({ status: z.literal("alive") });
export const errorSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(["NOT_FOUND", "INVALID_REQUEST", "INTERNAL_ERROR"]),
    message: z.string(),
    requestId: z.string(),
  }),
});
export const syntheticJobSchema = z.strictObject({ nonce: z.uuid() });
export const SYNTHETIC_QUEUE = "phase0-synthetic";
export const SYNTHETIC_JOB = "synthetic.ping";
export const routes = {
  live: "/api/health/live",
  ready: "/api/health/ready",
} as const;
export const jsonSchemas = {
  live: z.toJSONSchema(liveSchema, { target: "draft-7" }),
  ready: z.toJSONSchema(readinessSchema, { target: "draft-7" }),
  error: z.toJSONSchema(errorSchema, { target: "draft-7" }),
};
export function openApiDocument() {
  return {
    openapi: "3.1.0",
    info: { title: "Conference Platform Infrastructure API", version: "0.0.0" },
    paths: {
      [routes.live]: {
        get: {
          operationId: "getLiveness",
          responses: {
            "200": {
              description: "Process alive",
              content: { "application/json": { schema: jsonSchemas.live } },
            },
          },
        },
      },
      [routes.ready]: {
        get: {
          operationId: "getReadiness",
          responses: Object.fromEntries(
            [
              ["200", "Dependencies ready"],
              ["503", "Dependency unavailable"],
            ].map(([status, description]) => [
              status,
              {
                description,
                content: { "application/json": { schema: jsonSchemas.ready } },
              },
            ]),
          ),
        },
      },
    },
    components: { schemas: { Error: jsonSchemas.error } },
  };
}

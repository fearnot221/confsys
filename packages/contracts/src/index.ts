import {competitionEndpoints} from './competitions.js';
export * from './competitions.js';
import {onsiteEndpoints} from './onsite.js';
export * from './onsite.js';
import {activityEndpoints} from './activities.js';
export * from './activities.js';
export * from "./documents.js";
export * from "./program.js";
import {receiptEndpoints} from "./documents.js";
import {programEndpoints} from "./program.js";
import {reviewEndpoints} from "./reviews.js";
export * from "./reviews.js";
import {financeEndpoints} from "./finance.js";
export * from "./finance.js";
import { invitationEndpoints } from "./invitations.js";
export * from "./invitations.js";
import { fileEndpoints } from "./files.js";
export * from "./files.js";
import { submissionEndpoints } from "./submissions.js";
export * from "./submissions.js";
import { registrationEndpoints } from "./registration.js";
export * from "./registration.js";
import { siteEndpoints } from "./site.js";
export * from "./site.js";
import { accessEndpoints } from "./access.js";
export * from "./access.js";
import {
  authOperations,
  accountSchema,
  csrfSchema,
  errorCodeSchema,
} from "./auth.js";
export * from "./auth.js";
import { z } from "zod";
export const publicInstanceSchema = z.strictObject({
  conferenceName: z.string().min(1).max(160),
});
export type PublicInstance = z.infer<typeof publicInstanceSchema>;
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
    code: errorCodeSchema,
    message: z.string(),
    requestId: z.string(),
  }),
});
export const syntheticJobSchema = z.strictObject({ nonce: z.uuid() });
export const SYNTHETIC_QUEUE = "phase0-synthetic";
export const SYNTHETIC_JOB = "synthetic.ping";
export const routes = {
  instance: "/api/instance",
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
      ...authPaths(),
      ...accessPaths(),
      ...sitePaths(),
      ...modulePaths(invitationEndpoints),
      ...modulePaths(fileEndpoints),
      ...modulePaths(submissionEndpoints),
      ...modulePaths(registrationEndpoints),
      ...modulePaths(reviewEndpoints),
      ...modulePaths(financeEndpoints),
      ...modulePaths(receiptEndpoints),
      ...modulePaths(programEndpoints),
      ...modulePaths(activityEndpoints),
      ...modulePaths(onsiteEndpoints),
      ...modulePaths(competitionEndpoints),
      [routes.instance]: {
        get: {
          operationId: "getInstance",
          responses: {
            200: {
              description: "Public conference display configuration",
              content: {
                "application/json": {
                  schema: z.toJSONSchema(publicInstanceSchema),
                },
              },
            },
          },
        },
      },
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

function authPaths() {
  const response = (schema: z.ZodType, description: string) => ({
    description,
    content: {
      "application/json": {
        schema: z.toJSONSchema(schema, { target: "draft-7" }),
      },
    },
  });
  return {
    ...Object.fromEntries(
      Object.entries(authOperations).map(([operationId, op]) => [
        op.path,
        {
          post: {
            operationId,
            parameters: [
              {
                in: "header",
                name: "x-csrf-token",
                required: true,
                schema: { type: "string" },
              },
              {
                in: "header",
                name: "Origin",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: z.toJSONSchema(op.input, { target: "draft-7" }),
                },
              },
            },
            responses: {
              [op.status]: response(op.output, "Result"),
              ...Object.fromEntries(
                [400, 401, 403, 429, 500, 503].map((code) => [
                  code,
                  response(errorSchema, "Safe error"),
                ]),
              ),
            },
          },
        },
      ]),
    ),
    "/api/auth/csrf": {
      get: {
        operationId: "csrf",
        responses: {
          200: response(
            csrfSchema,
            "Anonymous or authenticated CSRF bootstrap",
          ),
        },
      },
    },
    "/api/auth/me": {
      get: {
        operationId: "me",
        responses: {
          200: response(accountSchema, "Own account"),
          401: response(errorSchema, "Session expired"),
          503: response(errorSchema, "Database unavailable"),
        },
      },
    },
  };
}

function accessPaths() {
  return Object.fromEntries(
    Object.entries(accessEndpoints).map(([operationId, spec]) => [
      spec.path.replace(":id", "{id}"),
      {
        [spec.method]: {
          operationId,
          parameters: [
            ...(spec.path.includes(":id")
              ? [
                  {
                    in: "path",
                    name: "id",
                    required: true,
                    schema: { type: "string", format: "uuid" },
                  },
                ]
              : []),
            ...(spec.method === "post"
              ? [
                  {
                    in: "header",
                    name: "Origin",
                    required: true,
                    schema: { type: "string" },
                  },
                  {
                    in: "header",
                    name: "x-csrf-token",
                    required: true,
                    schema: { type: "string" },
                  },
                ]
              : []),
            ...(spec.method === "get" && "input" in spec
              ? [
                  {
                    in: "query",
                    name: "query",
                    style: "form",
                    explode: true,
                    schema: z.toJSONSchema(spec.input),
                  },
                ]
              : []),
          ],
          ...(spec.method === "post" && "input" in spec
            ? {
                requestBody: {
                  required: true,
                  content: {
                    "application/json": { schema: z.toJSONSchema(spec.input) },
                  },
                },
              }
            : {}),
          responses: {
            200: {
              description: "Authorized explicit projection",
              content: {
                "application/json": { schema: z.toJSONSchema(spec.output) },
              },
            },
            ...Object.fromEntries(
              [400, 401, 403, 404, 409, 500, 503].map((code) => [
                code,
                {
                  description: "Safe error",
                  content: {
                    "application/json": { schema: jsonSchemas.error },
                  },
                },
              ]),
            ),
          },
        },
      },
    ]),
  );
}

function sitePaths() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const [operationId, spec] of Object.entries(siteEndpoints)) {
    const input = "input" in spec ? spec.input : null;
    const operation = {
      operationId,
      ...(spec.method === "post"
        ? {
            parameters: [
              {
                in: "header",
                name: "Origin",
                required: true,
                schema: { type: "string" },
              },
              {
                in: "header",
                name: "x-csrf-token",
                required: true,
                schema: { type: "string" },
              },
            ],
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: z.toJSONSchema(input!) },
              },
            },
          }
        : input
          ? {
              parameters: [
                {
                  in: "query",
                  name: "query",
                  style: "form",
                  explode: true,
                  schema: z.toJSONSchema(input),
                },
              ],
            }
          : {}),
      responses: Object.fromEntries(
        [200, 400, 401, 403, 404, 409, 413, 500, 503].map((code) => [
          code,
          {
            description:
              code === 200 ? "Explicit site projection" : "Safe error",
            content: {
              "application/json": {
                schema: z.toJSONSchema(
                  code === 200 ? spec.output : errorSchema,
                ),
              },
            },
          },
        ]),
      ),
    };
    paths[spec.path] = { ...paths[spec.path], [spec.method]: operation };
  }
  return paths;
}

function modulePaths(endpoints:Record<string,{method:string;path:string;input?:z.ZodType;output:z.ZodType}>) {
 const paths:Record<string,Record<string,unknown>>={};
 for(const [operationId,spec] of Object.entries(endpoints)) {
  const path=spec.path.replace(/:([a-zA-Z]+)/g,'{$1}');
  paths[path]={...paths[path],[spec.method]:{operationId,parameters:[...(spec.path.includes(':id')?[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}]:[]),...(spec.method==='post'?[{in:'header',name:'Origin',required:true,schema:{type:'string'}},{in:'header',name:'x-csrf-token',required:true,schema:{type:'string'}}]:spec.input?[{in:'query',name:'query',style:'form',explode:true,schema:z.toJSONSchema(spec.input)}]:[])],...(spec.method==='post'&&spec.input?{requestBody:{required:true,content:{'application/json':{schema:z.toJSONSchema(spec.input)}}}}:{}),responses:Object.fromEntries([200,400,401,403,404,409,413,415,500,503].map(code=>[code,{description:code===200?'Authorized projection':'Safe error',content:{'application/json':{schema:z.toJSONSchema(code===200?spec.output:errorSchema)}}}]))}};
 }
 return paths;
}

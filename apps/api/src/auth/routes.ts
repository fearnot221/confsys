import type { FastifyInstance } from "fastify";
import cookie from "@fastify/cookie";
import csrf from "@fastify/csrf-protection";
import {
  authOperations,
  emailInput,
  loginInput,
  tokenPasswordInput,
  accountSchema,
  csrfSchema,
  reauthenticateInput,
} from "@confsys/contracts";
import type { ApiConfig } from "@confsys/config";
import type { AuthService } from "./service.js";
import type { RateLimiter } from "./rate-limit.js";
import { AuthError } from "./errors.js";
import { z } from "zod";
export function cookiePolicy(config: ApiConfig) {
  const secure = config.PUBLIC_APP_ORIGIN.startsWith("https:");
  return {
    name: secure ? "__Host-session" : "dev-session",
    csrfName: secure ? "__Host-csrf" : "dev-csrf",
    options: { path: "/", httpOnly: true, secure, sameSite: "lax" as const },
  };
}
export async function registerAuthRoutes(
  app: FastifyInstance,
  deps: { config: ApiConfig; service: AuthService; limit: RateLimiter },
) {
  const { config, service, limit } = deps;
  const policy = cookiePolicy(config);
  await app.register(cookie, { secret: config.CSRF_SIGNING_KEY });
  await app.register(csrf, {
    cookieKey: policy.csrfName,
    cookieOpts: { ...policy.options, signed: true },
    getToken: (req) => {
      const header = req.headers["x-csrf-token"];
      return typeof header === "string" ? header : undefined;
    },
  });
  app.get(
    "/api/auth/csrf",
    { schema: { response: { 200: z.toJSONSchema(csrfSchema) } } },
    async (req, reply) => {
      if (req.headers.origin && req.headers.origin !== config.PUBLIC_APP_ORIGIN)
        throw new AuthError("CSRF_REJECTED");
      return { csrfToken: reply.generateCsrf() };
    },
  );
  app.get(
    "/api/auth/me",
    { schema: { response: { 200: z.toJSONSchema(accountSchema) } } },
    async (req) => service.me(req.cookies[policy.name]),
  );
  for (const [operation, spec] of Object.entries(authOperations)) {
    app.post(
      spec.path,
      {
        onRequest: [
          async (req) => {
            if (req.headers.origin !== config.PUBLIC_APP_ORIGIN)
              throw new AuthError("CSRF_REJECTED");
          },
          app.csrfProtection,
        ],
        schema: { response: { [spec.status]: z.toJSONSchema(spec.output) } },
      },
      async (req, reply) => {
        const parsed = spec.input.safeParse(req.body);
        if (!parsed.success) throw new AuthError("INVALID_REQUEST");
        if (operation !== "logout") {
          const subject =
            "email" in parsed.data
              ? parsed.data.email
              : "token" in parsed.data
                ? parsed.data.token
                : req.cookies[policy.name];
          await limit(
            operation === "register" || operation === "resend"
              ? "verification"
              : operation,
            req.ip,
            subject,
          );
        }
        switch (operation) {
          case "emailChangeRequest":
            await service.requestEmailChange(req.cookies[policy.name],emailInput.parse(parsed.data).email,req.id);
            return reply.code(202).send({status:"accepted"});
          case "emailChangeConfirm":
            await service.confirmEmailChange(req.cookies[policy.name],parsed.data,req.id);
            reply.clearCookie(policy.name,policy.options);
            return {status:"complete"};
          case "register":
          case "resend":
          case "forgot":
            await service.requestMail(
              operation,
              emailInput.parse(parsed.data).email,
              req.id,
            );
            return reply.code(202).send({ status: "accepted" });
          case "verify":
          case "reset": {
            const { token, password } = tokenPasswordInput.parse(parsed.data);
            await service.consume(operation, token, password, req.id);
            reply.clearCookie(policy.name, policy.options);
            return { status: "complete" };
          }
          case "login": {
            const { email, password } = loginInput.parse(parsed.data);
            const result = await service.login(email, password, req.id);
            reply.setCookie(policy.name, result.raw, {
              ...policy.options,
              maxAge: config.SESSION_ABSOLUTE_SECONDS,
            });
            return result.account;
          }
          case "reauthenticate":
            await service.reauthenticate(
              req.cookies[policy.name],
              reauthenticateInput.parse(parsed.data).password,
              req.id,
            );
            return { status: "complete" };
          case "logout":
            await service.logout(req.cookies[policy.name], req.id);
            reply.clearCookie(policy.name, policy.options);
            return { status: "complete" };
        }
      },
    );
  }
}

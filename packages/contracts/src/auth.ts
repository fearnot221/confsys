import { z } from "zod";
export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email().max(254));
// Character counting uses Unicode code points; no trimming or normalization of passwords.
export const passwordSchema = z
  .string()
  .max(512)
  .refine(
    (value) => [...value].length >= 15 && [...value].length <= 128,
    "Use 15–128 characters",
  );
export const emailInput = z.strictObject({ email: emailSchema });
export const loginInput = z.strictObject({
  email: emailSchema,
  password: z.string().min(1).max(512),
});
export const tokenPasswordInput = z.strictObject({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password: passwordSchema,
});
export const emptyInput = z.strictObject({});
export const acceptedSchema = z.strictObject({ status: z.literal("accepted") });
export const doneSchema = z.strictObject({ status: z.literal("complete") });
export const csrfSchema = z.strictObject({ csrfToken: z.string() });
export const accountSchema = z.strictObject({
  user: z.strictObject({
    id: z.uuid(),
    email: z.email(),
    verified: z.literal(true),
  }),
});
export type Account = z.infer<typeof accountSchema>;
export const authOperations = {
  register: {
    path: "/api/auth/register",
    input: emailInput,
    output: acceptedSchema,
    status: 202,
  },
  resend: {
    path: "/api/auth/resend",
    input: emailInput,
    output: acceptedSchema,
    status: 202,
  },
  forgot: {
    path: "/api/auth/forgot",
    input: emailInput,
    output: acceptedSchema,
    status: 202,
  },
  verify: {
    path: "/api/auth/verify",
    input: tokenPasswordInput,
    output: doneSchema,
    status: 200,
  },
  reset: {
    path: "/api/auth/reset",
    input: tokenPasswordInput,
    output: doneSchema,
    status: 200,
  },
  login: {
    path: "/api/auth/login",
    input: loginInput,
    output: accountSchema,
    status: 200,
  },
  logout: {
    path: "/api/auth/logout",
    input: emptyInput,
    output: doneSchema,
    status: 200,
  },
} as const;
export type AuthOperation = keyof typeof authOperations;
export const errorStatuses = {
  NOT_FOUND: 404,
  INVALID_REQUEST: 400,
  INTERNAL_ERROR: 500,
  FORBIDDEN: 403,
  CONFLICT: 409,
  REQUEST_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INVALID_CREDENTIALS: 401,
  SESSION_EXPIRED: 401,
  CSRF_REJECTED: 403,
  INVALID_TOKEN: 400,
  WEAK_PASSWORD: 400,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
} as const;
export type ErrorCode = keyof typeof errorStatuses;
export const errorCodeSchema = z.enum(
  Object.keys(errorStatuses) as [ErrorCode, ...ErrorCode[]],
);

export type AuthInput<K extends AuthOperation> = z.input<
  (typeof authOperations)[K]["input"]
>;

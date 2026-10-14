import { z } from "zod";
export const minorAmount = z.string().regex(/^(0|[1-9][0-9]{0,11})$/);
const label = z.string().trim().min(1).max(160);
export const formFieldSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
  label,
  type: z.enum([
    "text",
    "long_text",
    "number",
    "select",
    "multiselect",
    "date",
    "checkbox",
    "description",
  ]),
  showWhen: z
    .strictObject({
      fieldKey: z.string().regex(/^[a-z][a-z0-9_]{0,39}$/),
      equals: z.union([z.string().max(300), z.number().finite(), z.boolean()]),
    })
    .optional(),
  required: z.boolean(),
  options: z.array(label).max(30),
});
export const registrationConfigSchema = z.strictObject({
  opensAt: z.iso.datetime(),
  closesAt: z.iso.datetime(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone: z
    .string()
    .max(80)
    .refine((v) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: v });
        return true;
      } catch {
        return false;
      }
    }),
  consent: z.string().trim().min(1).max(3000),
  fields: z.array(formFieldSchema).max(30),
  tickets: z
    .array(
      z.strictObject({
        id: z.uuid(),
        name: label,
        capacity: z.number().int().min(1).max(100000),
        waitlist: z.boolean(),
        rates: z
          .array(
            z.strictObject({
              startsAt: z.iso.datetime(),
              endsAt: z.iso.datetime(),
              amount: minorAmount,
            }),
          )
          .min(1)
          .max(10),
      }),
    )
    .min(1)
    .max(30),
});
export type RegistrationConfig = z.infer<typeof registrationConfigSchema>;
export const registrationConfigResult = z.strictObject({
  version: z.number().int(),
  document: registrationConfigSchema.nullable(),
});
export const registrationConfigInput = z.strictObject({
  expectedVersion: z.number().int().min(0),
  document: registrationConfigSchema,
});
export const answerValue = z.union([
  z.string().max(4000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(160)).max(30),
]);
export const registrationInput = z.strictObject({
  idempotencyKey: z.uuid(),
  configVersion: z.number().int().positive(),
  ticketId: z.uuid(),
  badgeName: label,
  affiliation: z.string().trim().max(300),
  consent: z.literal(true),
  answers: z.record(z.string().max(40), answerValue),
});
export type RegistrationInput = z.infer<typeof registrationInput>;
export const registrationSchema = z.strictObject({
  id: z.uuid(),
  number: z.string(),
  version: z.number().int().positive(),
  formFields: z.array(formFieldSchema),
  state: z.enum(["confirmed", "waitlisted", "cancelled"]),
  ticketName: label,
  badgeName: label,
  affiliation: z.string(),
  configVersion: z.number().int(),
  answers: z.record(z.string(), answerValue),
  createdAt: z.iso.datetime(),
  order: z
    .strictObject({
      id: z.uuid(),
      state: z.enum(["open", "cancelled"]),
      amount: minorAmount,
      currency: z.string(),
      paid: minorAmount,
      refunded: minorAmount,
    })
    .nullable(),
});
export type Registration = z.infer<typeof registrationSchema>;
export const registrationList = z.strictObject({
  items: z.array(registrationSchema),
  nextOffset: z.number().int().nullable(),
});
export const registrationPage = z.strictObject({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const registrationCancel = z.strictObject({
  id: z.uuid(),
  reason: z.string().trim().min(3).max(300),
});
export const registrationEdit = z.strictObject({
  id: z.uuid(),
  expectedVersion: z.number().int().positive(),
  badgeName: label,
  affiliation: z.string().trim().max(300),
  answers: z.record(z.string().max(40), answerValue),
  reason: z.string().trim().min(3).max(300),
});
export const registrationPromote = z.strictObject({
  id: z.uuid(),
  expectedVersion: z.number().int().positive(),
  reason: z.string().trim().min(3).max(300),
});
export const registrationHistory = z.strictObject({
  items: z.array(
    z.strictObject({
      version: z.number().int(),
      before: registrationSchema,
      after: registrationSchema,
      reason: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
  nextOffset: z.number().int().nullable(),
});
export const registrationHistoryInput = z.strictObject({
  id: z.uuid(),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
});
export const registrationEndpoints = {
  registrationEdit: {
    method: "post",
    path: "/api/registration/edit",
    input: registrationEdit,
    output: registrationSchema,
  },
  registrationPromote: {
    method: "post",
    path: "/api/registration/promote",
    input: registrationPromote,
    output: registrationSchema,
  },
  registrationHistory: {
    method: "get",
    path: "/api/registration/history",
    input: registrationHistoryInput,
    output: registrationHistory,
  },
  registrationConfig: {
    method: "get",
    path: "/api/registration/config",
    output: registrationConfigResult,
  },
  registrationConfigure: {
    method: "post",
    path: "/api/registration/config",
    input: registrationConfigInput,
    output: registrationConfigResult,
  },
  registrationMine: {
    method: "get",
    path: "/api/registration/mine",
    input: registrationPage,
    output: registrationList,
  },
  registrationAdmin: {
    method: "get",
    path: "/api/registration/admin",
    input: registrationPage,
    output: registrationList,
  },
  registrationCreate: {
    method: "post",
    path: "/api/registration/create",
    input: registrationInput,
    output: registrationSchema,
  },
  registrationCancel: {
    method: "post",
    path: "/api/registration/cancel",
    input: registrationCancel,
    output: registrationSchema,
  },
} as const;

// Conditions only refer to earlier scalar fields. Hidden ancestors cannot be
// activated by forged answers; this same pure projection drives form rendering.
export function visibleRegistrationFields(
  fields: RegistrationConfig["fields"],
  answers: RegistrationInput["answers"],
) {
  const visible = new Set<string>();
  return fields.filter((field) => {
    const condition = field.showWhen;
    const show =
      !condition ||
      (visible.has(condition.fieldKey) &&
        answers[condition.fieldKey] === condition.equals);
    if (show) visible.add(field.key);
    return show;
  });
}
export function visibleRegistrationAnswers(
  fields: RegistrationConfig["fields"],
  answers: RegistrationInput["answers"],
): RegistrationInput["answers"] {
  return Object.fromEntries(
    visibleRegistrationFields(fields, answers)
      .filter(
        (field) =>
          field.type !== "description" && answers[field.key] !== undefined,
      )
      .map((field) => [field.key, answers[field.key]!]),
  );
}

export type RegistrationHistory = z.infer<typeof registrationHistory>;

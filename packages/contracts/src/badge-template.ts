import { z } from "zod";
export const badgeTemplateDocument = z.strictObject({
  size: z.enum(["credit_card", "large"]),
  layout: z.enum(["centered", "left"]),
  showAffiliation: z.boolean(),
  showRegistrationNumber: z.boolean(),
  footer: z.string().trim().max(120).refine(value => [...value].every(char => char.charCodeAt(0)>=32 && char.charCodeAt(0)!==127)),
});
export type BadgeTemplateDocument = z.infer<typeof badgeTemplateDocument>;
export const badgeTemplate = z.strictObject({version:z.number().int().min(0),document:badgeTemplateDocument.nullable()});
export type BadgeTemplate = z.infer<typeof badgeTemplate>;
export const badgeTemplateSave = z.strictObject({expectedVersion:z.number().int().min(0),document:badgeTemplateDocument});
export const badgeTemplateEndpoints = {
 badgeTemplateGet:{method:"get",path:"/api/badge-template",input:z.strictObject({}),output:badgeTemplate},
 badgeTemplateSave:{method:"post",path:"/api/badge-template",input:badgeTemplateSave,output:badgeTemplate},
} as const;

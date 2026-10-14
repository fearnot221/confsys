import { z } from "zod";
const label=z.string().trim().min(1).max(200),version=z.number().int().min(0),uuid=z.uuid();
export const programRoomSchema=z.strictObject({id:uuid,name:label,venue:label,bufferMinutes:z.number().int().min(0).max(120)});
export const programBlockedSchema=z.strictObject({id:uuid,roomId:uuid,startsAt:z.iso.datetime(),endsAt:z.iso.datetime(),reason:label});
export const programSessionSchema=z.strictObject({id:uuid,roomId:uuid,title:label,startsAt:z.iso.datetime(),endsAt:z.iso.datetime(),chairName:label,chairEmail:z.email()});
export const programSlotInput=z.strictObject({id:uuid,sessionId:uuid,kind:z.enum(["oral","poster","invited"]),revisionId:uuid.nullable(),startsAt:z.iso.datetime(),endsAt:z.iso.datetime(),posterNumber:z.number().int().min(1).max(100000).nullable(),invitedTitle:z.string().trim().max(500),invitedSpeaker:z.string().trim().max(200),invitedAffiliation:z.string().trim().max(300),invitedEmail:z.union([z.email(),z.literal("")])});
export const programSlotSchema=programSlotInput.extend({title:z.string(),presenterName:z.string(),presenterAffiliation:z.string(),submissionId:uuid.nullable()});
export const programDraftSchema=z.strictObject({version,rooms:z.array(programRoomSchema),blocked:z.array(programBlockedSchema),sessions:z.array(programSessionSchema),slots:z.array(programSlotSchema),activePublicationId:uuid.nullable()});
export type ProgramDraft=z.infer<typeof programDraftSchema>;
export const programPublicSlotSchema=z.strictObject({id:uuid,kind:z.enum(["oral","poster","invited"]),title:z.string(),presenterName:z.string(),presenterAffiliation:z.string(),startsAt:z.string(),endsAt:z.string(),posterNumber:z.number().int().nullable()});
export const programPublicSessionSchema=z.strictObject({id:uuid,title:z.string(),roomName:z.string(),venue:z.string(),startsAt:z.string(),endsAt:z.string(),chairName:z.string(),slots:z.array(programPublicSlotSchema)});
export const programPublicSchema=z.strictObject({publicationId:uuid.nullable(),publishedAt:z.string().nullable(),sessions:z.array(programPublicSessionSchema)});
export type PublicProgram=z.infer<typeof programPublicSchema>;
const write=<T extends z.ZodType>(item:T)=>z.strictObject({expectedVersion:version,item});
export const programEndpoints={
 programPublic:{method:"get",path:"/api/program",output:programPublicSchema},
 programDraft:{method:"get",path:"/api/program/draft",output:programDraftSchema},
 programRoom:{method:"post",path:"/api/program/rooms",input:write(programRoomSchema),output:programDraftSchema},
 programBlocked:{method:"post",path:"/api/program/blocked",input:write(programBlockedSchema),output:programDraftSchema},
 programSession:{method:"post",path:"/api/program/sessions",input:write(programSessionSchema),output:programDraftSchema},
 programSlot:{method:"post",path:"/api/program/slots",input:write(programSlotInput),output:programDraftSchema},
 programRemove:{method:"post",path:"/api/program/remove",input:z.strictObject({expectedVersion:version,kind:z.enum(["room","blocked","session","slot"]),id:uuid}),output:programDraftSchema},
 programPublish:{method:"post",path:"/api/program/publish",input:z.strictObject({expectedVersion:version}),output:programPublicSchema},
} as const;

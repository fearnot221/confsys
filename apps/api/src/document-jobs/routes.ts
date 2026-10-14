import type {FastifyInstance} from "fastify";
import type {ApiConfig} from "@confsys/config";
import {documentJobEndpoints} from "@confsys/contracts";
import {z} from "zod";
import {cookiePolicy} from "../auth/routes.js";
import {AuthError} from "../auth/errors.js";
import type {createDocumentJobsService} from "./service.js";
export function registerDocumentJobRoutes(app:FastifyInstance,config:ApiConfig,service:ReturnType<typeof createDocumentJobsService>) {
 for(const [name,spec] of Object.entries(documentJobEndpoints))app.route({method:spec.method.toUpperCase() as "GET"|"POST",url:spec.path,onRequest:spec.method==="post"?[async req=>{if(req.headers.origin!==config.PUBLIC_APP_ORIGIN)throw new AuthError("CSRF_REJECTED");},app.csrfProtection]:[],schema:{response:{200:z.toJSONSchema(spec.output)}},handler:async req=>{const data=spec.input.safeParse(spec.method==="post"?req.body:req.query);if(!data.success)throw new AuthError("INVALID_REQUEST");const raw=req.cookies[cookiePolicy(config).name];if(name==="documentJobCreate")return service.create(raw,data.data,req.id);return service.list(raw,documentJobEndpoints.documentJobList.input.parse(data.data).offset);}});
 app.get("/api/document-jobs/:id/pdf",async(req,reply)=>{const data=z.strictObject({id:z.uuid()}).safeParse(req.params);if(!data.success)throw new AuthError("INVALID_REQUEST");const file=await service.download(req.cookies[cookiePolicy(config).name],data.data.id,req.id);return reply.type("application/pdf").header("content-disposition",`attachment; filename="${file.name}"`).header("cache-control","private, no-store").header("x-robots-tag","noindex, nofollow").send(file.bytes);});
}

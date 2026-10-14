import type { FastifyInstance } from "fastify";
import type { ApiConfig } from "@confsys/config";
import { receiptEndpoints, receiptHistorySchema } from "@confsys/contracts";
import { z } from "zod";
import { cookiePolicy } from "../auth/routes.js";
import { AuthError } from "../auth/errors.js";
import type { createReceiptsService } from "./service.js";
export function registerReceiptRoutes(app:FastifyInstance,config:ApiConfig,service:ReturnType<typeof createReceiptsService>) {
  for(const [name,spec] of Object.entries(receiptEndpoints)) app.route({
    method:spec.method.toUpperCase() as "GET"|"POST",url:spec.path,
    onRequest:spec.method==="post"?[async req=>{if(req.headers.origin!==config.PUBLIC_APP_ORIGIN)throw new AuthError("CSRF_REJECTED");},app.csrfProtection]:[],
    schema:{response:{200:z.toJSONSchema(spec.output)}},
    handler:async(req)=>{
      const parsed=spec.input.safeParse(spec.method==="post"?req.body:req.query);
      if(!parsed.success)throw new AuthError("INVALID_REQUEST");
      const raw=req.cookies[cookiePolicy(config).name];
      switch(name){
        case "receiptMine":return service.list(raw,receiptEndpoints.receiptMine.input.parse(req.query).offset);
        case "receiptAdmin":return service.list(raw,receiptEndpoints.receiptAdmin.input.parse(req.query).offset,true);
        case "receiptIssue":return service.issue(raw,parsed.data,req.id);
        case "receiptCorrect":return service.correct(raw,parsed.data,req.id);
        case "receiptVoid":return service.void(raw,parsed.data,req.id);
      }
    },
  });
  app.get("/api/receipts/:id/history",{schema:{response:{200:z.toJSONSchema(receiptHistorySchema)}}},async req=>{
    const parsed=z.strictObject({id:z.uuid()}).safeParse(req.params);if(!parsed.success)throw new AuthError("INVALID_REQUEST");
    return service.history(req.cookies[cookiePolicy(config).name],parsed.data.id);
  });
  app.get("/api/receipts/:id/pdf",async(req,reply)=>{
    const params=z.strictObject({id:z.uuid()}).safeParse(req.params),query=z.strictObject({revision:z.coerce.number().int().min(1).max(100)}).safeParse(req.query);
    if(!params.success||!query.success)throw new AuthError("INVALID_REQUEST");
    const file=await service.download(req.cookies[cookiePolicy(config).name],params.data.id,query.data.revision,req.id);
    return reply.type("application/pdf").header("content-disposition",`attachment; filename="${file.name}"`).header("x-robots-tag","noindex, nofollow").send(file.bytes);
  });
}

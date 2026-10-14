import type { FastifyInstance } from 'fastify';
import type { ApiConfig } from '@confsys/config';
import { registrationEndpoints,registrationPage,registrationHistoryInput } from '@confsys/contracts';
import { z } from 'zod';
import { AuthError } from '../auth/errors.js';
import { cookiePolicy } from '../auth/routes.js';
import type { createRegistrationService } from './service.js';
export function registerRegistrationRoutes(app:FastifyInstance,config:ApiConfig,service:ReturnType<typeof createRegistrationService>) {
 for(const [name,spec] of Object.entries(registrationEndpoints)) app.route({method:spec.method.toUpperCase() as 'GET'|'POST',url:spec.path,bodyLimit:131072,onRequest:spec.method==='post'?[async req=>{if(req.headers.origin!==config.PUBLIC_APP_ORIGIN)throw new AuthError('CSRF_REJECTED');},app.csrfProtection]:[],schema:{response:{200:z.toJSONSchema(spec.output)}},handler:async(req)=>{
 const raw=req.cookies[cookiePolicy(config).name];if('input' in spec&&!spec.input.safeParse(spec.method==='post'?req.body:req.query).success)throw new AuthError('INVALID_REQUEST');
 switch(name){case 'registrationEdit':return service.edit(raw,req.body,req.id);case 'registrationPromote':return service.promote(raw,req.body,req.id);case 'registrationHistory':return service.history(raw,registrationHistoryInput.parse(req.query).id);case 'registrationConfig':return service.configuration();case 'registrationConfigure':return service.configure(raw,req.body,req.id);case 'registrationMine':return service.mine(raw,registrationPage.parse(req.query).offset);case 'registrationAdmin':return service.admin(raw,registrationPage.parse(req.query).offset);case 'registrationCreate':return service.create(raw,req.body,req.id);case 'registrationCancel':return service.cancel(raw,req.body,req.id);}
 }});
}

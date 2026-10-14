import type {FastifyInstance} from 'fastify';
import type {ApiConfig} from '@confsys/config';
import {activityEndpoints,activityPage} from '@confsys/contracts';
import {z} from 'zod';
import {AuthError} from '../auth/errors.js';
import {cookiePolicy} from '../auth/routes.js';
import type {createActivitiesService} from './service.js';
export function registerActivityRoutes(app:FastifyInstance,config:ApiConfig,service:ReturnType<typeof createActivitiesService>){for(const[name,spec]of Object.entries(activityEndpoints))app.route({method:spec.method.toUpperCase() as 'GET'|'POST',url:spec.path,bodyLimit:65536,onRequest:spec.method==='post'?[async req=>{if(req.headers.origin!==config.PUBLIC_APP_ORIGIN)throw new AuthError('CSRF_REJECTED');},app.csrfProtection]:[],schema:{response:{200:z.toJSONSchema(spec.output)}},handler:async req=>{const raw=req.cookies[cookiePolicy(config).name];if('input'in spec&&!spec.input.safeParse(spec.method==='post'?req.body:req.query).success)throw new AuthError('INVALID_REQUEST');switch(name){case'activitiesCatalog':return service.catalog();case'activitiesSave':return service.save(raw,req.body,req.id);case'activitiesBook':return service.book(raw,req.body,req.id);case'activitiesMine':return service.mine(raw,activityPage.parse(req.query).offset);case'activitiesAdmin':return service.admin(raw,activityPage.parse(req.query).offset);case'activitiesCancel':return service.cancel(raw,req.body,req.id);}}});}

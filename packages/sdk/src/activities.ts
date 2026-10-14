import { activityEndpoints,csrfSchema,errorSchema } from '@confsys/contracts';
import { ApiError } from './errors.js';
export function createActivitiesClient(base='',transport:typeof fetch=fetch) {
 async function request(path:string,init:RequestInit) {const r=await transport(base+path,{credentials:'same-origin',cache:'no-store',...init});const data:unknown=await r.json();if(!r.ok){const e=errorSchema.safeParse(data);throw new ApiError(e.success?e.data.error.code:'INVALID_RESPONSE',r.status,e.success?e.data.error.requestId:undefined);}return data;}
 return {async call<K extends keyof typeof activityEndpoints>(operation:K,input:unknown,signal:AbortSignal) {
 const spec=activityEndpoints[operation];let path=spec.path;const init:RequestInit={signal};
 if(spec.method==='post') {const parsed=('input' in spec?spec.input.parse(input):{});const {csrfToken}=csrfSchema.parse(await request('/api/auth/csrf',{signal}));Object.assign(init,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':csrfToken},body:JSON.stringify(parsed)});}
 else if('input' in spec) {const query=spec.input.parse(input);path+=`?${new URLSearchParams(Object.entries(query).map(([k,v])=>[k,String(v)]))}`;}
 return spec.output.parse(await request(path,init));
 }};
}

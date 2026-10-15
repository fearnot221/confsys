import {z} from 'zod';
import {receiptHistorySchema} from './documents.js';
const attachments = [
 ['/api/files/{id}/download','fileDownload',['application/pdf','image/png','image/jpeg'],'Authorized owner or explicitly permitted private file'],
 ['/api/media/{id}','publishedMedia',['image/png','image/jpeg'],'Image referenced by the active public site publication'],
 ['/api/reviews/assignments/{assignmentId}/files/{fileId}','reviewFileDownload',['application/pdf'],'Current accepted reviewer assignment and current submission revision'],
 ['/api/finance/payments/{id}/evidence','paymentEvidenceDownload',['application/pdf','image/png','image/jpeg'],'Authorized payment evidence'],
 ['/api/receipts/{id}/pdf','receiptPdf',['application/pdf'],'Authorized immutable receipt revision'],
 ['/api/onsite/qr/{id}','onsiteQr',['image/png'],'Authorized participant pass'],
 ['/api/document-jobs/{id}/pdf','documentJobPdf',['application/pdf'],'Authorized completed badge batch'],
 ['/api/reporting/export-jobs/{id}/download','exportJobDownload',['text/csv'],'Owned completed unexpired export; current export permission and recent password proof'],
 ['/api/badge-template/preview','badgeTemplatePreview',['application/pdf'],'Authorized stored template with synthetic noncredential sample'],
] as const;
export function downloadPaths(error:z.ZodType){
 const errors=Object.fromEntries([400,401,403,404,409,500,503].map(code=>[code,{description:'Safe error',content:{'application/json':{schema:z.toJSONSchema(error)}}}]));
 const paths:Record<string,unknown>={};
 for(const [path,operationId,types,description] of attachments){
  const parameters:unknown[]=[...path.matchAll(/\{(\w+)\}/g)].map(match=>({in:'path',name:match[1],required:true,schema:{type:'string',format:'uuid'}}));
  if(operationId==='receiptPdf')parameters.push({in:'query',name:'revision',required:true,schema:{type:'integer',minimum:1,maximum:100}});
  paths[path]={get:{operationId,parameters,responses:{...errors,200:{description,content:Object.fromEntries(types.map(type=>[type,{schema:{type:'string',...(type==='text/csv'?{}:{format:'binary'})}}]))}}}};
 }
 paths['/api/receipts/{id}/history']={get:{operationId:'receiptHistory',parameters:[{in:'path',name:'id',required:true,schema:{type:'string',format:'uuid'}}],responses:{...errors,200:{description:'Authorized immutable receipt history',content:{'application/json':{schema:z.toJSONSchema(receiptHistorySchema)}}}}}};
 return paths;
}

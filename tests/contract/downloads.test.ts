import {it,expect} from 'vitest';
import {openApiDocument} from '@confsys/contracts';
it('documents exact download parameters, types and immutable receipt revision',()=>{
 const paths:Record<string,unknown>=openApiDocument().paths;
 expect(paths['/api/reviews/assignments/{assignmentId}/files/{fileId}']).toMatchObject({get:{parameters:[{in:'path',name:'assignmentId',required:true},{in:'path',name:'fileId',required:true}],responses:{200:{content:{'application/pdf':{schema:{type:'string',format:'binary'}}}}}}});
 expect(paths['/api/receipts/{id}/pdf']).toMatchObject({get:{parameters:expect.arrayContaining([{in:'query',name:'revision',required:true,schema:{type:'integer',minimum:1,maximum:100}}])}});
 for(const path of ['/api/files/{id}/download','/api/receipts/{id}/history','/api/document-jobs/{id}/pdf','/api/badge-template/preview','/api/reporting/export-jobs/{id}/download'])
  expect(paths[path]).toMatchObject({get:{responses:{403:{content:{'application/json':expect.any(Object)}}}}});
});

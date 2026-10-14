import { createRequire } from "node:module";
import { Worker } from "node:worker_threads";
import { AuthError } from "../auth/errors.js";
const require = createRequire(import.meta.url);
// Bound parser CPU and heap separately from the API event loop. PDF bytes never leave the instance.
export async function validatePdf(bytes: Buffer): Promise<void> {
  const parser = require.resolve("pdf-lib");
  const valid = await new Promise<boolean>((resolve) => {
    let settled = false;
    const worker = new Worker(`
      const {parentPort,workerData}=require('node:worker_threads');
      const {PDFDocument}=require(workerData.parser);
      (async()=>{
        try {
          const doc=await PDFDocument.load(workerData.bytes,{ignoreEncryption:false,throwOnInvalidObject:true,updateMetadata:false});
          if(doc.getPageCount()<1 || doc.getPageCount()>500) throw new Error('pages');
          for(const [,object] of doc.context.enumerateIndirectObjects()) {
            const representation=object.toString().replace(/#([a-fA-F0-9]{2})/g,(_,v)=>String.fromCharCode(parseInt(v,16)));
            if(/\\/(?:JavaScript|JS|Launch|EmbeddedFile|OpenAction|AA)\\b/.test(representation)) throw new Error('active');
          }
          parentPort.postMessage(true);
        } catch {parentPort.postMessage(false);}
      })();`, {eval:true,stdout:true,stderr:true,workerData:{parser,bytes},resourceLimits:{maxOldGenerationSizeMb:64,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
    worker.stdout?.resume();
    worker.stderr?.resume();
    const finish=(value:boolean)=>{if(settled)return;settled=true;clearTimeout(timer);void worker.terminate();resolve(value);};
    const timer=setTimeout(()=>finish(false),3000);
    worker.once("message",value=>finish(value===true));
    worker.once("error",()=>finish(false));
    worker.once("exit",()=>finish(false));
  });
  if(!valid) throw new AuthError("UNSUPPORTED_MEDIA_TYPE");
}

import { expect,it } from "vitest";
import { fileUploadInput, fileAssetSchema } from "@confsys/contracts";
import { createFilesClient } from "@confsys/sdk";
it("file contracts forbid caller-chosen owner, storage key, status and unbounded content",()=>{
  const valid={name:"paper.pdf",purpose:"manuscript",content:"YWJj"};
  expect(fileUploadInput.safeParse(valid).success).toBe(true);
  for(const key of ["ownerId","storageKey","status","public"]){expect(fileUploadInput.safeParse({...valid,[key]:"forged"}).success).toBe(false);}
  expect(fileUploadInput.safeParse({...valid,name:"../paper.pdf"}).success).toBe(false);
  expect(fileUploadInput.safeParse({...valid,content:"YWJj".repeat(3_000_000)}).success).toBe(false);
  expect(fileAssetSchema.safeParse({storage_key:"secret"}).success).toBe(false);
});
it("SDK uses CSRF and abort signal for scan retry and never treats quarantine as clean",async()=>{
  const calls:{url:string;init:RequestInit|undefined}[]=[],signal=new AbortController().signal;
  const client=createFilesClient("",async(url,init)=>{
    calls.push({url:String(url),init});
    return Response.json(String(url).endsWith("/csrf")?{csrfToken:"proof"}:{id:"00000000-0000-4000-8000-000000000001",purpose:"manuscript",name:"paper.pdf",mediaType:"application/pdf",size:100,sha256:"0".repeat(64),status:"quarantined",createdAt:"2026-10-15T00:00:00Z"});
  });
  const result=await client.retry("00000000-0000-4000-8000-000000000001",signal);
  expect(result.status).toBe("quarantined");expect(calls[1]?.init).toMatchObject({method:"POST",signal,credentials:"same-origin",headers:{"x-csrf-token":"proof"}});
});

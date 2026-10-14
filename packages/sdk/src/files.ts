import { csrfSchema, errorSchema, fileAssetSchema, fileListSchema, fileUploadInput, type FilePurpose } from "@confsys/contracts";
import { ApiError } from "./errors.js";
export function createFilesClient(baseUrl = "",transport: typeof fetch = fetch) {
  async function request(path: string,init: RequestInit) {
    const response=await transport(baseUrl+path,{credentials:"same-origin",cache:"no-store",...init});
    if(!response.ok) {
      const error=errorSchema.safeParse(await response.json());
      throw new ApiError(error.success ? error.data.error.code : "INVALID_RESPONSE",response.status,error.success ? error.data.error.requestId : undefined);
    }
    return response;
  }
  async function post(path: string,data: unknown,signal: AbortSignal) {
    const {csrfToken}=csrfSchema.parse(await (await request("/api/auth/csrf",{signal})).json());
    return request(path,{method:"POST",signal,headers:{"content-type":"application/json","x-csrf-token":csrfToken},body:JSON.stringify(data)});
  }
  return {
    async list(offset: number,signal: AbortSignal) { return fileListSchema.parse(await (await request(`/api/files?offset=${offset}`,{signal})).json()); },
    async upload(file: File,purpose: FilePurpose,signal: AbortSignal) {
      if(file.size > 8*1024*1024 || !file.size) throw new ApiError("REQUEST_TOO_LARGE",413);
      const bytes=new Uint8Array(await file.arrayBuffer());
      let binary="";
      for(let start=0;start<bytes.length;start+=16384) binary+=String.fromCharCode(...bytes.subarray(start,start+16384));
      const data=fileUploadInput.parse({purpose,name:file.name,content:btoa(binary)});
      return fileAssetSchema.parse(await (await post("/api/files",data,signal)).json());
    },
    async retry(id: string,signal: AbortSignal) { return fileAssetSchema.parse(await (await post(`/api/files/${encodeURIComponent(id)}/scan`,{},signal)).json()); },
    async download(id: string,signal: AbortSignal) { return (await request(`/api/files/${encodeURIComponent(id)}/download`,{signal})).blob(); },
  };
}

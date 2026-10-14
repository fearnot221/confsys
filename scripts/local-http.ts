import http from "node:http";
import { isLocalHostname } from "@confsys/config";
// Test runner mapping only: browsers resolve *.localhost themselves. Never used by product SDK.
export const localFetch: typeof fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  if (url.protocol !== "http:" || !isLocalHostname(url.hostname))
    throw new Error("Local HTTP target required");
  return new Promise<Response>((resolve, reject) => {
    const headers = new Headers(init.headers);
    if (!headers.has("host")) headers.set("host", url.host);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: url.port,
        path: url.pathname + url.search,
        method: init.method ?? "GET",
        headers: Object.fromEntries(headers),
        timeout: 10000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("error", reject);
        res.on("end", () => {
          const result = new Headers();
          for (const [key, value] of Object.entries(res.headers))
            for (const item of Array.isArray(value)
              ? value
              : value
                ? [value]
                : [])
              result.append(key, item);
          resolve(
            new Response(Buffer.concat(chunks), {
              status: res.statusCode ?? 500,
              headers: result,
            }),
          );
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("Local request timeout")));
    req.on("error", reject);
    if (init.body) {
      if (typeof init.body !== "string")
        throw new Error("String test body required");
      req.write(init.body);
    }
    req.end();
  });
};

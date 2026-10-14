import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
import { loadIngressConfig } from "../packages/config/dist/index.js";
const config = loadIngressConfig();
const canonicalHost = new URL(config.PUBLIC_APP_ORIGIN).host;
const root = resolve("apps/web/dist");
const server = http.createServer(async (req, res) => {
  if (req.headers.host !== canonicalHost) {
    res.writeHead(403);
    res.end("Unrecognized host");
    return;
  }
  let pathname;
  try {
    pathname = new URL(req.url ?? "/", "http://localhost").pathname;
  } catch {
    res.writeHead(400, { "cache-control": "no-store" });
    res.end("Invalid request target");
    return;
  }
  const spa =
    /^\/auth\/(login|register|waiting|verify|forgot|reset|account|invitation)$/.test(
      pathname,
    ) ||
    ["/access/accounts", "/admin/site", "/admin/invitations", "/account/files", "/registration", "/admin/registration", "/submissions", "/admin/submissions", "/finance", "/admin/finance", "/activities", "/admin/activities", "/reviews", "/program", "/admin/program", "/receipts", "/admin/receipts", "/system/status"].includes(pathname);
  if (!spa && !pathname.startsWith("/assets/")) {
    const upstream = http.request(
      {
        host: "api",
        port: 23000,
        path: req.url,
        method: req.method,
        headers: {
          accept: "application/json",
          host: canonicalHost,
          ...Object.fromEntries(
            [
              "content-type",
              "content-length",
              "cookie",
              "origin",
              "x-csrf-token",
            ]
              .filter((key) => req.headers[key] !== undefined)
              .map((key) => [key, req.headers[key]]),
          ),
        },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.setTimeout(30000, () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent)
        res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE" } }));
    });
    req.pipe(upstream);
    return;
  }
  try {
    const file = resolve(
      root,
      "." + (spa ? "/index.html" : decodeURIComponent(pathname)),
    );
    if (!file.startsWith(root + sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    const body = await readFile(file);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".js": "text/javascript",
      ".css": "text/css",
      ".svg": "image/svg+xml",
    };
    res.writeHead(200, {
      "content-type": types[extname(file)] ?? "application/octet-stream",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "cache-control": pathname.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-store",
      "x-robots-tag": "noindex, nofollow",
      "content-security-policy":
        "default-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
});
server.listen(25173, "0.0.0.0");
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close());

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";
const root = resolve("/app/apps/web/dist");
const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith("/api/")) {
    const upstream = http.request(
      {
        host: "api",
        port: 23000,
        path: req.url,
        method: req.method,
        headers: { accept: "application/json" },
      },
      (response) => {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
      },
    );
    upstream.setTimeout(5000, () => upstream.destroy());
    upstream.on("error", () => {
      if (!res.headersSent)
        res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: "UPSTREAM_UNAVAILABLE" } }));
    });
    req.pipe(upstream);
    return;
  }
  try {
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    const file = resolve(
      root,
      "." + (path === "/" ? "/index.html" : decodeURIComponent(path)),
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

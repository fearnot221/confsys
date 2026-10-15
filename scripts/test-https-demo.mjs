// Real isolated PostgreSQL/Redis/Mailpit + HTTPS proxy regression. No public ACME.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import { randomBytes } from "node:crypto";

const root = resolve(".");
const temp = mkdtempSync(join(tmpdir(), "confsys-https-"));
const project = `confsys-https-test-${randomBytes(4).toString("hex")}`;
const domain = `${project}.example.com`;
const env = {
  ...process.env,
  DEMO_DOMAIN: domain,
  DEMO_PROJECT_NAME: project,
  DEMO_MAIL_PORT: "18025",
  COMPOSE_PROFILES: "",
  DEMO_ADMIN_EMAIL: "admin@demo.invalid",
};
async function freePort() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  return port;
}
const [httpPort, httpsPort, mailPort] = await Promise.all([
  freePort(),
  freePort(),
  freePort(),
]);
const fixture = join(temp, "Caddyfile");
writeFileSync(
  fixture,
  readFileSync("deploy/https-demo/Caddyfile", "utf8").replace(
    "{$DEMO_DOMAIN} {",
    "{$DEMO_DOMAIN} {\n\ttls internal",
  ),
);
const override = join(temp, "test.yaml");
writeFileSync(
  override,
  `services:
  proxy:
    ports: !override ["127.0.0.1:${httpPort}:80", "127.0.0.1:${httpsPort}:443"]
    volumes:
      - ${JSON.stringify(fixture + ":/etc/caddy/Caddyfile:ro")}
  mailpit:
    ports: !override ["127.0.0.1:${mailPort}:8025"]
`,
);
const args = [
  "compose",
  "--env-file",
  "/dev/null",
  "--project-name",
  project,
  "-f",
  resolve("deploy/demo/compose.yaml"),
  "-f",
  resolve("deploy/https-demo/compose.yaml"),
];
const run = (extra, test = true, quiet = false) =>
  execFileSync(
    "docker",
    [...args, ...(test ? ["-f", override] : []), ...extra],
    {
      cwd: root,
      env,
      encoding: "utf8",
      stdio: quiet ? "pipe" : "inherit",
      timeout: 600000,
    },
  );
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ca;
function request(
  path,
  { method = "GET", body, cookie = "", origin, csrf, plain = false } = {},
) {
  return new Promise((resolveRequest, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = (plain ? http : https).request(
      {
        hostname: "127.0.0.1",
        port: plain ? httpPort : httpsPort,
        servername: domain,
        ca,
        path,
        method,
        headers: {
          host: domain,
          cookie,
          ...(origin ? { origin } : {}),
          ...(csrf ? { "x-csrf-token": csrf } : {}),
          ...(payload
            ? {
                "content-type": "application/json",
                "content-length": Buffer.byteLength(payload),
              }
            : {}),
        },
        timeout: 5000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolveRequest({
            status: res.statusCode,
            headers: res.headers,
            text: Buffer.concat(chunks).toString(),
          }),
        );
      },
    );
    req.on("timeout", () => req.destroy(new Error("HTTPS test timeout")));
    req.on("error", reject);
    req.end(payload);
  });
}
try {
  // Assert the real public configuration, before test-only overrides.
  const model = JSON.parse(run(["config", "--format", "json"], false, true));
  for (const name of ["web", "api", "worker", "postgres", "redis"])
    assert.equal(model.services[name].ports?.length ?? 0, 0, name);
  assert.deepEqual(
    model.services.mailpit.ports.map((p) => p.host_ip),
    ["127.0.0.1"],
  );
  assert.deepEqual(
    model.services.proxy.ports.map((p) => String(p.published)).sort(),
    ["443", "80"],
  );
  for (const name of ["api", "worker", "web", "seed"]) {
    assert.equal(model.services[name].environment.NODE_ENV, "production");
    assert.equal(
      model.services[name].environment.PUBLIC_APP_ORIGIN,
      `https://${domain}`,
    );
  }
  run(
    [
      "run",
      "--rm",
      "--no-deps",
      "proxy",
      "caddy",
      "validate",
      "--config",
      "/etc/caddy/Caddyfile",
      "--adapter",
      "caddyfile",
    ],
    false,
  );
  run(["build", "api"]);
  run(["up", "-d", "--wait", "--wait-timeout", "300", "web", "mailpit"]);
  for (const service of ["api", "worker"]) {
    run([
      "exec",
      "-T",
      service,
      "node",
      "-e",
      `
      const fs = require('node:fs');
      if (fs.existsSync('/secrets/demo.env')) process.exit(1);
      const keys = [...fs.readFileSync('/runtime/runtime.env', 'utf8').matchAll(/^([A-Z_]+)=/gm)].map(match => match[1]);
      if (keys.some(key => /PASSWORD|MIGRAT|POSTGRES/.test(key))) process.exit(2);
      if (!keys.includes('${service === "api" ? "DATABASE_URL" : "WORKER_DATABASE_URL"}')) process.exit(3);
      if (keys.includes('${service === "api" ? "WORKER_DATABASE_URL" : "DATABASE_URL"}')) process.exit(4);
    `,
    ]);
  }
  run(["run", "--rm", "--no-deps", "seed"]);
  run(["up", "-d", "proxy"]);
  const proxy = run(["ps", "-q", "proxy"], true, true).trim();
  for (let i = 0; ; i++) {
    try {
      ca = execFileSync(
        "docker",
        ["exec", proxy, "cat", "/data/caddy/pki/authorities/local/root.crt"],
        { stdio: ["ignore", "pipe", "pipe"] },
      );
      break;
    } catch (e) {
      if (i >= 30) throw e;
      await sleep(1000);
    }
  }
  let home;
  for (let i = 0; ; i++) {
    try {
      home = await request("/");
      assert.equal(home.status, 200);
      break;
    } catch (e) {
      if (i >= 30) throw e;
      await sleep(1000);
    }
  }
  assert.match(home.text, /<html/);
  assert.equal(home.headers["x-robots-tag"], "noindex, nofollow");
  const redirect = await request("/auth/login", { plain: true });
  assert.equal(redirect.status, 308);
  assert.equal(redirect.headers.location, `https://${domain}/auth/login`);
  assert.equal((await request("/auth/login")).status, 200);
  const csrf = await request("/api/auth/csrf");
  assert.equal(csrf.status, 200);
  const setCookies = csrf.headers["set-cookie"];
  assert.ok(
    setCookies.some(
      (c) =>
        c.startsWith("__Host-csrf=") &&
        /; Secure/i.test(c) &&
        /; HttpOnly/i.test(c),
    ),
  );
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  const token = JSON.parse(csrf.text).csrfToken;
  const password = run(
    [
      "run",
      "--rm",
      "--no-deps",
      "-T",
      "--entrypoint",
      "sh",
      "secrets",
      "-c",
      'sed -n "s/^DEMO_ADMIN_PASSWORD=//p" /secrets/demo.env',
    ],
    true,
    true,
  ).trim();
  assert.equal(
    (
      await request("/api/auth/login", {
        method: "POST",
        body: { email: "admin@demo.invalid", password },
        cookie,
        csrf: token,
        origin: "https://foreign.example.com",
      })
    ).status,
    403,
  );
  const login = await request("/api/auth/login", {
    method: "POST",
    body: { email: "admin@demo.invalid", password },
    cookie,
    csrf: token,
    origin: `https://${domain}`,
  });
  assert.equal(login.status, 200);
  assert.ok(
    login.headers["set-cookie"].some(
      (c) => c.startsWith("__Host-session=") && /; Secure/i.test(c),
    ),
  );
  assert.ok(JSON.parse(login.text).user.roles.includes("conference_admin"));
  const authenticated = [...setCookies, ...login.headers["set-cookie"]]
    .map((c) => c.split(";")[0])
    .join("; ");
  assert.equal(
    (await request("/api/site/draft", { cookie: authenticated })).status,
    200,
  );
  assert.equal((await request("/api/site/draft")).status, 401);
  const logout = await request("/api/auth/logout", {
    method: "POST",
    body: {},
    cookie: authenticated,
    csrf: token,
    origin: `https://${domain}`,
  });
  assert.equal(logout.status, 200);
  assert.equal(
    (await request("/api/site/draft", { cookie: authenticated })).status,
    401,
  );
  const original = home.text;
  run(["down"]);
  run(["up", "-d", "--wait", "--wait-timeout", "300", "web", "mailpit"]);
  run(["run", "--rm", "--no-deps", "seed"]);
  run(["up", "-d", "proxy"]);
  for (let i = 0; ; i++) {
    try {
      assert.equal((await request("/")).text, original);
      break;
    } catch (e) {
      if (i >= 30) throw e;
      await sleep(1000);
    }
  }
  console.log(
    "HTTPS demo passed: private ports, verified TLS/redirect, Secure cookies, login/CSRF, protected draft/revocation, persistent idempotent seed.",
  );
} finally {
  // Only this randomly named synthetic project is removed.
  try {
    run(["down", "-v", "--remove-orphans"]);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

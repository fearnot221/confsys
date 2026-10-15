import { request as httpRequest } from "node:http";
import { promisify } from "node:util";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv, parseArgs } from "node:util";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, expect, type Page } from "@playwright/test";
import { createPool } from "@confsys/db";
import { initialSite, siteLocales, sitePages } from "@confsys/contracts";
import { localFetch } from "./local-http.js";
import { enrichRestoreFixtures } from "./restore-fixtures.js";

// Own fresh resources only. No global cleanup and no reuse of user volumes.
const run = randomUUID().slice(0, 8);
const { values: options } = parseArgs({
  options: {
    image: { type: "string" },
    help: { type: "boolean", default: false },
    "restore-fixtures": { type: "boolean", default: false },
    "native-scanner": { type: "boolean", default: false },
    "scanner-port": { type: "string", default: "53310" },
    "prepare-only": { type: "boolean", default: false },
  },
});
if (options.help) {
  console.log(
    "Usage: pnpm test:instances [--image IMAGE] [--native-scanner --scanner-port PORT] [--prepare-only] [--restore-fixtures]\n--restore-fixtures: after isolation checks, create real A registration/QR/badge PDF/CSV and pause only A worker with pending encrypted mail for a same-instance restore drill. Resources retained.",
  );
  process.exit(0);
}
const scannerPort = Number(options["scanner-port"]);
if (!Number.isInteger(scannerPort) || scannerPort < 1024 || scannerPort > 65535)
  throw new Error("scanner-port must be 1024..65535");
const image = options.image ?? `confsys:p6-${run}`;
const reservations: ReturnType<typeof createServer>[] = [];
async function reservePort() {
  const server = createServer();
  await new Promise<void>((accept, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", accept);
  });
  reservations.push(server);
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("No port allocated");
  return {
    port: address.port,
    release: () =>
      new Promise<void>((done, reject) =>
        server.close((error) => (error ? reject(error) : done())),
      ),
  };
}
const directory = `.instances/${run}`;
mkdirSync(".instances", { recursive: true });
mkdirSync(directory, { mode: 0o700 });
const evidence: Record<string, unknown> = { run, image, checks: [] };
const checks: string[] = [];
const record = (value: string) => {
  checks.push(value);
  console.log(value);
};
function command(args: string[], env: NodeJS.ProcessEnv = process.env) {
  execFileSync(process.execPath, args, { env, stdio: "inherit" });
}
const instances = await Promise.all(
  ["a", "b"].map(async (letter) => {
    const ports = await Promise.all(Array.from({ length: 5 }, reservePort));
    const file = `${directory}/${letter}.env`;
    const origin = `http://${letter}-${run}.localhost:${ports[0]!.port}`;
    command(
      ["--conditions=development", "--import", "tsx", "scripts/setup.mjs"],
      {
        ...process.env,
        CONFSYS_ENV_FILE: file,
        COMPOSE_PROJECT_NAME: `confsys-p6-${run}-${letter}`,
        APP_IMAGE: image,
        PUBLIC_APP_ORIGIN: origin,
        CONFERENCE_NAME: `Synthetic Conference ${letter.toUpperCase()}`,
        PRIVATE_STORAGE_ROOT: resolve(directory, `${letter}-private`),
        CLAMAV_PORT: String(scannerPort),
        WEB_PORT: String(ports[0]!.port),
        POSTGRES_PORT: String(ports[1]!.port),
        REDIS_PORT: String(ports[2]!.port),
        MAILPIT_PORT: String(ports[3]!.port),
        SMTP_PORT: String(ports[4]!.port),
      },
    );
    const env = parseEnv(readFileSync(file, "utf8"));
    const compose = (...args: string[]) =>
      command(
        [
          "--conditions=development",
          "--import",
          "tsx",
          "scripts/compose.mjs",
          ...(options["native-scanner"]
            ? ["-f", "compose.yaml", "-f", "compose.native-scanner.yaml"]
            : []),
          ...args,
        ],
        { ...process.env, CONFSYS_ENV_FILE: file },
      );
    return {
      letter,
      file,
      origin,
      env,
      compose,
      releasePorts: () => Promise.all(ports.map((p) => p.release())),
      db: createPool(env.MIGRATION_DATABASE_URL!, 1),
    };
  }),
);
const a = instances[0]!,
  b = instances[1]!;
function inspect(instance: typeof a) {
  const ids = execFileSync(
    "docker",
    [
      "ps",
      "-aq",
      "--filter",
      `label=com.docker.compose.project=${instance.env.COMPOSE_PROJECT_NAME}`,
    ],
    { encoding: "utf8" },
  )
    .trim()
    .split("\n")
    .filter(Boolean);
  const data: {
    Id: string;
    State: { StartedAt: string };
    Name: string;
    Image: string;
    Config: { Labels: Record<string, string>; Env: string[] };
    NetworkSettings: { Networks: Record<string, { IPAddress: string }> };
    Mounts: {
      Type: string;
      Name?: string;
      Source: string;
      Destination: string;
    }[];
  }[] = JSON.parse(
    execFileSync("docker", ["inspect", ...ids], { encoding: "utf8" }),
  );
  return data;
}
async function post(
  instance: typeof a,
  operation: string,
  body: object,
  extra: Record<string, string> = {},
) {
  const csrf = await localFetch(`${instance.origin}/api/auth/csrf`);
  expect(csrf.status).toBe(200);
  const token = (await csrf.json()).csrfToken as string;
  return localFetch(`${instance.origin}/api/auth/${operation}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: instance.origin,
      "x-csrf-token": token,
      cookie: csrf.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
      ...extra,
    },
    body: JSON.stringify(body),
  });
}
async function messages(instance: typeof a, email: string) {
  const body: { messages: { ID: string; Subject: string }[] } = await fetch(
    `${instance.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
  ).then((r) => r.json());
  return body.messages;
}
async function mail(
  instance: typeof a,
  email: string,
  kind: "verify" | "reset",
) {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        id = (await messages(instance, email)).find((m) =>
          m.Subject.includes(
            kind === "verify" ? "Verify email" : "Reset password",
          ),
        )?.ID;
        return !!id;
      },
      { timeout: 20000 },
    )
    .toBe(true);
  const detail: { Text: string; Subject: string } = await fetch(
    `${instance.env.MAILPIT_URL}/api/v1/message/${id}`,
  ).then((r) => r.json());
  expect(detail.Subject).toContain(instance.env.CONFERENCE_NAME);
  expect(detail.Text).toContain(instance.env.CONFERENCE_NAME);
  const link = detail.Text.match(
    /http:\/\/[^\s]+\/auth\/(?:verify|reset)#token=[A-Za-z0-9_-]+/,
  )?.[0];
  if (!link) throw new Error("Capture link missing");
  expect(new URL(link).origin).toBe(instance.origin);
  return {
    link,
    token: new URLSearchParams(new URL(link).hash.slice(1)).get("token")!,
  };
}
async function login(
  page: Page,
  instance: typeof a,
  email: string,
  password: string,
) {
  await page.goto(`${instance.origin}/auth/login`);
  await expect(page.getByRole("heading")).toHaveText(
    `登入 ${instance.env.CONFERENCE_NAME}`,
  );
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByTestId("account-email")).toHaveText(email);
}
async function snapshotB() {
  // Read-only snapshots exclude mutable last_seen_at (session read intentionally updates it).
  return (
    await b.db.query(
      `SELECT jsonb_build_object('site',(SELECT jsonb_agg(s) FROM confsys.site_state s),'publications',(SELECT jsonb_agg(p) FROM confsys.site_publications p),'users',(SELECT jsonb_agg(u) FROM confsys.users u),'sessions',(SELECT jsonb_agg(jsonb_build_object('id',s.id,'token_hash',s.token_hash,'revoked_at',s.revoked_at)) FROM confsys.sessions s),'roles',(SELECT jsonb_agg(r) FROM confsys.user_roles r),'bootstrap',(SELECT jsonb_agg(c) FROM confsys.access_control c),'audit',(SELECT count(*) FROM confsys.auth_audit),'migrations',(SELECT jsonb_agg(m) FROM confsys.schema_migrations m)) AS state`,
    )
  ).rows[0].state;
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  if (options["prepare-only"]) {
    writeFileSync(
      `${directory}/plan.json`,
      JSON.stringify(
        {
          run,
          image,
          nativeScanner: options["native-scanner"],
          restoreFixtures: options["restore-fixtures"],
          instances: instances.map((i) => ({
            envFile: i.file,
            origin: i.origin,
            project: i.env.COMPOSE_PROJECT_NAME,
          })),
        },
        null,
        2,
      ),
    );
    console.log(
      `Prepared isolated environment plan: ${directory}/plan.json; no containers started`,
    );
  } else {
    for (const instance of instances) {
      for (const resource of ["container", "volume", "network"]) {
        const existing = execFileSync(
          "docker",
          [
            resource,
            "ls",
            "-q",
            "--filter",
            `label=com.docker.compose.project=${instance.env.COMPOSE_PROJECT_NAME}`,
          ],
          { encoding: "utf8" },
        ).trim();
        if (existing)
          throw new Error(
            `Refusing to reuse existing ${resource} for this project`,
          );
      }
    }
    if (options["native-scanner"])
      command([
        "scripts/local-scanner.mjs",
        "check",
        "--port",
        String(scannerPort),
      ]);
    if (!options.image) a.compose("--profile", "app", "build", "api");
    for (const instance of instances) {
      await instance.releasePorts();
      instance.compose(
        "up",
        "-d",
        "--wait",
        "postgres",
        "redis",
        "mailpit",
        ...(options["native-scanner"] ? [] : ["clamav"]),
      );
      instance.compose("--profile", "app", "run", "--rm", "migrate");
      instance.compose(
        "--profile",
        "app",
        "up",
        "-d",
        "--no-build",
        "--wait",
        "api",
        "worker",
        "web",
      );
    }
    const ia = inspect(a),
      ib = inspect(b);
    const appContainers = [...ia, ...ib].filter((c) =>
      ["api", "worker", "web"].includes(
        c.Config.Labels["com.docker.compose.service"]!,
      ),
    );
    expect(new Set(appContainers.map((c) => c.Image)).size).toBe(1);
    evidence.imageId = appContainers[0]!.Image;
    for (const entry of appContainers) {
      const service = entry.Config.Labels["com.docker.compose.service"];
      const names = entry.Config.Env.map((v) => v.split("=")[0]);
      if (service === "api") {
        expect(names).not.toContain("WORKER_DATABASE_URL");
        expect(names).not.toContain("MIGRATION_DATABASE_URL");
      }
      if (service === "worker") {
        expect(names).not.toContain("DATABASE_URL");
        expect(names).not.toContain("CSRF_SIGNING_KEY");
      }
      if (service === "web") expect(names).not.toContain("MAIL_ENCRYPTION_KEY");
    }
    const networks = (items: typeof ia) => [
      ...new Set(items.flatMap((c) => Object.keys(c.NetworkSettings.Networks))),
    ];
    const volumes = (items: typeof ia) => [
      ...new Set(
        items.flatMap((c) =>
          c.Mounts.filter((m) => m.Type === "volume").map((m) => m.Name),
        ),
      ),
    ];
    expect(networks(ia).filter((n) => networks(ib).includes(n))).toEqual([]);
    expect(volumes(ia).filter((n) => volumes(ib).includes(n))).toEqual([]);
    for (const item of [...ia, ...ib])
      for (const mount of item.Mounts.filter((m) => m.Type === "bind"))
        expect(mount.Destination).toBe(
          "/docker-entrypoint-initdb.d/01-roles.sh",
        );
    evidence.resources = instances.map((instance, i) => ({
      project: instance.env.COMPOSE_PROJECT_NAME,
      origin: instance.origin,
      envFile: instance.file,
      networks: networks(i === 0 ? ia : ib),
      volumes: volumes(i === 0 ? ia : ib),
    }));
    for (const key of [
      "APP_PASSWORD",
      "WORKER_PASSWORD",
      "MIGRATOR_PASSWORD",
      "POSTGRES_PASSWORD",
      "MAIL_ENCRYPTION_KEY",
      "CSRF_SIGNING_KEY",
      "QR_SIGNING_KEY",
    ])
      expect(a.env[key] === b.env[key]).toBe(false);
    const wrongCredential = new URL(a.env.DATABASE_URL!);
    wrongCredential.password = new URL(b.env.DATABASE_URL!).password;
    const foreignPool = createPool(wrongCredential.href, 1);
    try {
      await expect(foreignPool.query("SELECT 1")).rejects.toMatchObject({
        code: "28P01",
      });
    } finally {
      await foreignPool.end();
    }
    for (const [from, to] of [
      [ia, ib],
      [ib, ia],
    ] as const) {
      const client = from.find(
        (c) => c.Config.Labels["com.docker.compose.service"] === "api",
      )!;
      execFileSync(
        "docker",
        [
          "exec",
          client.Id,
          "node",
          "-e",
          "const fs=require('node:fs');if(fs.existsSync('/app/.env')||fs.existsSync('/app/.instances'))process.exit(1)",
        ],
        { stdio: "pipe" },
      );
      for (const [service, port] of [
        ["postgres", "5432"],
        ["redis", "6379"],
      ] as const) {
        const target = to.find(
          (c) => c.Config.Labels["com.docker.compose.service"] === service,
        )!;
        const address = Object.values(target.NetworkSettings.Networks)[0]!
          .IPAddress;
        execFileSync(
          "docker",
          [
            "exec",
            client.Id,
            "node",
            "-e",
            "const s=require('node:net').connect({host:process.argv[1],port:Number(process.argv[2])});s.setTimeout(1000);s.on('connect',()=>{s.destroy();process.exit(1)});s.on('error',()=>process.exit(0));s.on('timeout',()=>{s.destroy();process.exit(0)})",
            address,
            port,
          ],
          { stdio: "pipe" },
        );
      }
    }
    record(
      "Same immutable image for both Web/API/worker; independent credentials, networks and data volumes; process config separation",
    );
    browser = await chromium.launch();
    const context = await browser.newContext();
    const pa = await context.newPage(),
      pb = await context.newPage();
    for (const [instance, page] of [
      [a, pa],
      [b, pb],
    ] as const) {
      await page.goto(`${instance.origin}/auth/register`);
      await expect(page.getByRole("heading")).toHaveText("建立本研討會帳號");
      await expect(page.locator(".brand")).toHaveText(
        instance.env.CONFERENCE_NAME!,
      );
      await expect(page).toHaveTitle(
        `${instance.env.CONFERENCE_NAME} · 帳號與安全`,
      );
      await expect(page.getByText("一個帳號參與不同研討會")).toHaveCount(0);
      const dto = await localFetch(`${instance.origin}/api/instance`).then(
        (r) => r.json(),
      );
      expect(dto).toEqual({ conferenceName: instance.env.CONFERENCE_NAME });
      const invalidTargetStatus = await new Promise<number>(
        (resolve, reject) => {
          const url = new URL(instance.origin);
          const request = httpRequest(
            {
              hostname: "127.0.0.1",
              port: Number(url.port),
              path: "http://[",
              headers: { host: url.host },
            },
            (response) => {
              response.resume();
              resolve(response.statusCode ?? 0);
            },
          );
          request.on("error", reject);
          request.end();
        },
      );
      expect(invalidTargetStatus).toBe(400);
      expect(
        (await localFetch(`${instance.origin}/api/health/live`)).status,
      ).toBe(200);
      const html = await localFetch(`${instance.origin}/auth/login`).then((r) =>
        r.text(),
      );
      for (const asset of html.matchAll(
        /(?:src|href)="([^" ]+\.(?:js|css))"/g,
      )) {
        const bundle = await localFetch(`${instance.origin}${asset[1]}`).then(
          (r) => r.text(),
        );
        for (const other of instances)
          for (const key of [
            "MAIL_ENCRYPTION_KEY",
            "CSRF_SIGNING_KEY",
            "DATABASE_URL",
            "WORKER_DATABASE_URL",
          ])
            expect(bundle.includes(other.env[key]!)).toBe(false);
        expect(bundle.includes(instance.env.CONFERENCE_NAME!)).toBe(false);
      }
    }
    record(
      "Same browser context resolves both localhost hostnames; runtime display/title and public DTO/bundle secrecy",
    );
    const email = `dual-${run}@example.invalid`,
      passA = `Synthetic A phrase ${run}!`,
      passB = `Synthetic B phrase ${run}!`,
      newA = `Replacement A phrase ${run}!`;
    expect(
      (
        await post(
          a,
          "register",
          { email },
          { "x-forwarded-host": "evil.invalid" },
        )
      ).status,
    ).toBe(202);
    const va = await mail(a, email, "verify");
    expect((await messages(b, email)).length).toBe(0);
    expect(
      (await b.db.query("SELECT id FROM confsys.users WHERE email=$1", [email]))
        .rowCount,
    ).toBe(0);
    expect(
      (await post(b, "verify", { token: va.token, password: passA })).status,
    ).toBe(400);
    // Real browser follows Mailpit's canonical link, proving its hostname resolves.
    await pa.goto(va.link);
    await pa.getByLabel("新密碼", { exact: true }).fill(passA);
    await pa.getByRole("button", { name: "確認並啟用帳號" }).click();
    await expect(pa.getByRole("status")).toContainText("信箱驗證完成");
    const absent = await post(b, "login", { email, password: passA });
    expect(absent.status).toBe(401);
    expect((await absent.json()).error.code).toBe("INVALID_CREDENTIALS");
    expect((await post(b, "register", { email })).status).toBe(202);
    const vb = await mail(b, email, "verify");
    await pb.goto(vb.link);
    await pb.getByLabel("新密碼", { exact: true }).fill(passB);
    await pb.getByRole("button", { name: "確認並啟用帳號" }).click();
    await expect(pb.getByRole("status")).toContainText("信箱驗證完成");
    expect((await post(b, "login", { email, password: passA })).status).toBe(
      401,
    );
    expect((await post(a, "login", { email, password: passB })).status).toBe(
      401,
    );
    await login(pa, a, email, passA);
    await login(pb, b, email, passB);
    const cookies = await context.cookies();
    const sa = cookies.find(
        (c) =>
          c.name === "dev-session" && c.domain === new URL(a.origin).hostname,
      )!,
      sb = cookies.find(
        (c) =>
          c.name === "dev-session" && c.domain === new URL(b.origin).hostname,
      )!;
    expect(sa).toBeDefined();
    expect(sb).toBeDefined();
    expect(sa.value === sb.value).toBe(false);
    expect(sa.httpOnly && sb.httpOnly).toBe(true);
    expect(sa.sameSite).toBe("Lax");
    expect(
      (
        await localFetch(`${b.origin}/api/auth/me`, {
          headers: { cookie: `dev-session=${sa.value}` },
        })
      ).status,
    ).toBe(401);
    await pa.reload();
    await pb.reload();
    await expect(pa.getByTestId("account-email")).toHaveText(email);
    await expect(pb.getByTestId("account-email")).toHaveText(email);
    record(
      "A-only identity absent in B; identical email independent passwords; verification token rejection in B does not consume A; host-only cookies coexist; foreign session rejected",
    );
    const beforeReset = await snapshotB();
    expect((await post(a, "forgot", { email })).status).toBe(202);
    const reset = await mail(a, email, "reset");
    expect(
      (await post(b, "reset", { token: reset.token, password: newA })).status,
    ).toBe(400);
    expect(
      (await post(a, "reset", { token: reset.token, password: newA })).status,
    ).toBe(200);
    await expect
      .poll(
        async () =>
          (
            await a.db.query(
              "SELECT count(*) FROM confsys.notifications WHERE status IN ('pending','processing')",
            )
          ).rows[0].count,
      )
      .toBe("0");
    expect(await snapshotB()).toEqual(beforeReset);
    expect(
      (
        await localFetch(`${a.origin}/api/auth/me`, {
          headers: { cookie: `dev-session=${sa.value}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await localFetch(`${b.origin}/api/auth/me`, {
          headers: { cookie: `dev-session=${sb.value}` },
        })
      ).status,
    ).toBe(200);
    expect((await post(a, "login", { email, password: passA })).status).toBe(
      401,
    );
    await login(pa, a, email, newA);
    await pa.getByRole("button", { name: "登出", exact: true }).click();
    await expect(pa).toHaveURL(`${a.origin}/auth/login`);
    await pb.reload();
    await expect(pb.getByTestId("account-email")).toHaveText(email);
    await login(pb, b, email, passB);
    expect(
      (
        await localFetch(`${a.origin}/api/auth/csrf`, {
          headers: { host: "evil.invalid" },
        })
      ).status,
    ).toBe(403);
    record(
      "Reset/revoke/logout A leave B password/session/audit unchanged; foreign reset token invalid; forged Host rejected and forwarded Host cannot poison canonical mail URL",
    );
    const beforeAccess = await snapshotB();
    await login(pa, a, email, newA);
    const userA = (
      await a.db.query("SELECT id FROM confsys.users WHERE email=$1", [email])
    ).rows[0].id;
    const bootstrap = (apply: boolean, origin = a.origin) =>
      promisify(execFile)(
        process.execPath,
        [
          "--conditions=development",
          `--env-file=${a.file}`,
          "--import",
          "tsx",
          "scripts/bootstrap-admin.ts",
          "--user-id",
          userA,
          ...(apply
            ? [
                "--apply",
                "--reason",
                "synthetic dual-instance bootstrap",
                "--confirm-origin",
                origin,
              ]
            : []),
        ],
        { env: process.env },
      );
    expect(JSON.parse((await bootstrap(false)).stdout).changed).toBe(false);
    await expect(bootstrap(true, b.origin)).rejects.toBeDefined();
    expect(JSON.parse((await bootstrap(true)).stdout).changed).toBe(true);
    await login(pa, a, email, newA);
    const cookieA = (await context.cookies()).find(
      (c) =>
        c.name === "dev-session" && c.domain === new URL(a.origin).hostname,
    )!;
    expect(
      (
        await localFetch(`${b.origin}/api/access/accounts`, {
          headers: { cookie: `dev-session=${cookieA.value}` },
        })
      ).status,
    ).toBe(401);
    expect(
      (await b.db.query("SELECT count(*) FROM confsys.user_roles")).rows[0]
        .count,
    ).toBe("0");
    expect(
      (
        await b.db.query(
          "SELECT initialized_user_id FROM confsys.access_control",
        )
      ).rows[0].initialized_user_id,
    ).toBeNull();
    const managedEmail = `managed-${run}@example.invalid`;
    expect((await post(a, "register", { email: managedEmail })).status).toBe(
      202,
    );
    const managedLink = await mail(a, managedEmail, "verify");
    expect(
      (await post(a, "verify", { token: managedLink.token, password: passA }))
        .status,
    ).toBe(200);
    const managedId = (
      await a.db.query("SELECT id FROM confsys.users WHERE email=$1", [
        managedEmail,
      ])
    ).rows[0].id;
    const browserPost = async (path: string, body: object) => {
      const csrf = await (
        await pa.request.get(`${a.origin}/api/auth/csrf`)
      ).json();
      return pa.request.post(`${a.origin}${path}`, {
        data: body,
        headers: { origin: a.origin, "x-csrf-token": csrf.csrfToken },
      });
    };
    expect(
      (
        await browserPost("/api/auth/reauthenticate", { password: newA })
      ).status(),
    ).toBe(200);
    for (const action of [
      "grant",
      "revoke",
      "disable",
      "restore",
      "revoke_sessions",
    ]) {
      if (action === "revoke_sessions")
        expect(
          (await post(a, "login", { email: managedEmail, password: passA }))
            .status,
        ).toBe(200);
      const response = await browserPost(
        `/api/access/accounts/${managedId}/actions`,
        {
          action,
          reason: "synthetic A-only access test",
          ...(action === "grant" || action === "revoke"
            ? { role: "conference_staff" }
            : {}),
        },
      );
      expect(response.status()).toBe(200);
      expect((await response.json()).changed).toBe(true);
    }
    expect(await snapshotB()).toEqual(beforeAccess);
    await pb.reload();
    await expect(pb.getByTestId("account-email")).toHaveText(email);
    record(
      "A-only CLI bootstrap, reauthentication, grants/revokes/disable/restore/session revocation preserve B roles, bootstrap marker, accounts, sessions and audit; foreign admin cookie and wrong CLI origin rejected",
    );
    a.compose("--profile", "app", "stop", "worker");
    try {
      const waiting = `waiting-${run}@example.invalid`;
      expect((await post(a, "register", { email: waiting })).status).toBe(202);
      // Exercise B's worker while A's job is pending, without changing A's queue.
      const live = `live-${run}@example.invalid`;
      expect((await post(b, "register", { email: live })).status).toBe(202);
      await mail(b, live, "verify");
      expect((await messages(a, waiting)).length).toBe(0);
      expect((await messages(b, waiting)).length).toBe(0);
      expect(
        (
          await a.db.query(
            "SELECT n.status FROM confsys.notifications n JOIN confsys.users u ON u.id=n.user_id WHERE u.email=$1",
            [waiting],
          )
        ).rows[0].status,
      ).toBe("pending");
      a.compose("--profile", "app", "start", "worker");
      await mail(a, waiting, "verify");
      expect((await messages(b, waiting)).length).toBe(0);
    } finally {
      a.compose("--profile", "app", "start", "worker");
    }
    record(
      "Stopped A worker retains durable mail; live B worker processes only B; restarting A delivers only to A Mailpit",
    );
    const beforeRestart = inspect(b).map((c) => ({
      id: c.Id,
      startedAt: c.State.StartedAt,
      name: c.Name,
      image: c.Image,
    }));
    a.compose("--profile", "app", "stop", "web", "api", "worker");
    await pb.reload();
    await expect(pb.getByTestId("account-email")).toHaveText(email);
    a.compose(
      "--profile",
      "app",
      "up",
      "-d",
      "--no-build",
      "--wait",
      "api",
      "worker",
      "web",
    );
    expect(
      inspect(b).map((c) => ({
        id: c.Id,
        startedAt: c.State.StartedAt,
        name: c.Name,
        image: c.Image,
      })),
    ).toEqual(beforeRestart);
    const beforeMigrate = await snapshotB();
    a.compose("--profile", "app", "run", "--rm", "migrate");
    command([
      "--conditions=development",
      `--env-file=${a.file}`,
      "--import",
      "tsx",
      "scripts/smoke-stack.ts",
    ]);
    command([
      `--env-file=${a.file}`,
      "--conditions=development",
      "--import",
      "tsx",
      "scripts/smoke-auth.ts",
    ]);
    expect(await snapshotB()).toEqual(beforeMigrate);
    record(
      "A-only stop/restart/migration/smoke leaves B available and B schema/data unchanged",
    );
    // Site acceptance follows all retained auth/access/worker/smoke cases so their original bootstrap branding assertions remain intact.
    const bAdminEmail = `site-admin-b-${run}@example.invalid`;
    expect((await post(b, "register", { email: bAdminEmail })).status).toBe(
      202,
    );
    const bLink = await mail(b, bAdminEmail, "verify");
    expect(
      (await post(b, "verify", { token: bLink.token, password: passB })).status,
    ).toBe(200);
    const bAdminId = (
      await b.db.query("SELECT id FROM confsys.users WHERE email=$1", [
        bAdminEmail,
      ])
    ).rows[0].id;
    command([
      "--conditions=development",
      `--env-file=${b.file}`,
      "--import",
      "tsx",
      "scripts/bootstrap-admin.ts",
      "--user-id",
      bAdminId,
      "--apply",
      "--reason",
      "synthetic B site bootstrap",
      "--confirm-origin",
      b.origin,
    ]);
    await login(pa, a, email, newA);
    await login(pb, b, bAdminEmail, passB);
    const sitePost = async (
      page: Page,
      instance: typeof a,
      path: string,
      body: object,
    ) => {
      const csrf = await (
        await page.request.get(`${instance.origin}/api/auth/csrf`)
      ).json();
      const response = await page.request.post(`${instance.origin}${path}`, {
        data: body,
        headers: { origin: instance.origin, "x-csrf-token": csrf.csrfToken },
      });
      expect(response.status()).toBe(200);
      return response.json();
    };
    const document = (name: string) => {
      const d = initialSite(name);
      d.enabledLocales = [...siteLocales];
      d.startDate = "2027-10-15";
      d.endDate = "2027-10-16";
      d.contactEmail = "site@example.invalid";
      for (const lang of siteLocales) {
        d.translations[lang].name = `${name} ${lang}`;
        for (const page of sitePages) {
          d.translations[lang].pages[page].title = `${name} ${page}`;
          d.translations[lang].pages[page].description =
            `${name} ${page} description`;
          d.translations[lang].pages[page].body = `${name} ${page} content`;
        }
      }
      return d;
    };
    for (const [page, instance] of [
      [pa, a],
      [pb, b],
    ] as const) {
      await sitePost(page, instance, "/api/site/draft", {
        expectedVersion: 0,
        document: document(`Published ${instance.letter.toUpperCase()}`),
      });
      await sitePost(page, instance, "/api/site/publish", {
        expectedVersion: 1,
      });
      const html = await localFetch(`${instance.origin}/en/home`);
      expect(html.headers.get("cache-control")).toBe("no-store");
      const body = await html.text();
      expect(body).toContain(`Published ${instance.letter.toUpperCase()} en`);
      expect(body).toContain(`${instance.origin}/en/home`);
      expect(body).toContain('lang="en"');
      expect(body).toContain("2027-10-15");
      await page.goto(`${instance.origin}/admin/site`);
      await expect(page.getByLabel("會議名稱", { exact: true })).toHaveValue(
        `Published ${instance.letter.toUpperCase()} zh-Hant`,
      );
    }
    expect(
      (
        await b.db.query(
          "SELECT role FROM confsys.user_roles WHERE user_id=(SELECT id FROM confsys.users WHERE email=$1)",
          [email],
        )
      ).rowCount,
    ).toBe(0);
    const bSiteBaseline = await snapshotB(),
      bContainers = inspect(b).map((c) => ({
        id: c.Id,
        started: c.State.StartedAt,
        image: c.Image,
      }));
    const firstA = await (await localFetch(`${a.origin}/api/site`)).json();
    await sitePost(pa, a, "/api/site/draft", {
      expectedVersion: 1,
      document: document("Secret A draft"),
    });
    expect(
      (await (await localFetch(`${a.origin}/api/instance`)).json())
        .conferenceName,
    ).toBe("Published A zh-Hant");
    expect(await (await localFetch(`${a.origin}/`)).text()).not.toContain(
      "Secret A draft",
    );
    await sitePost(pa, a, "/api/site/publish", { expectedVersion: 2 });
    expect(await (await localFetch(`${a.origin}/`)).text()).toContain(
      "Secret A draft",
    );
    await sitePost(pa, a, "/api/site/restore", {
      expectedVersion: 2,
      publicationId: firstA.publicationId,
    });
    expect(await (await localFetch(`${a.origin}/`)).text()).toContain(
      "Secret A draft",
    );
    expect(await snapshotB()).toEqual(bSiteBaseline);
    expect(
      inspect(b).map((c) => ({
        id: c.Id,
        started: c.State.StartedAt,
        image: c.Image,
      })),
    ).toEqual(bContainers);
    const newCookieA = (await context.cookies()).find(
      (c) =>
        c.name === "dev-session" && c.domain === new URL(a.origin).hostname,
    )!;
    for (const path of [
      "/api/site/draft",
      "/api/site/preview?version=1",
      "/api/site/history",
    ])
      expect(
        (
          await localFetch(`${b.origin}${path}`, {
            headers: { cookie: `dev-session=${newCookieA.value}` },
          })
        ).status,
      ).toBe(401);
    const foreignCsrf = await localFetch(`${b.origin}/api/auth/csrf`);
    const foreignCsrfToken = (await foreignCsrf.json()).csrfToken;
    const foreignWrite = await localFetch(`${b.origin}/api/site/publish`, {
      method: "POST",
      headers: {
        origin: b.origin,
        "content-type": "application/json",
        "x-csrf-token": foreignCsrfToken,
        cookie:
          foreignCsrf.headers
            .getSetCookie()
            .map((v) => v.split(";")[0])
            .join("; ") + `; dev-session=${newCookieA.value}`,
      },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    expect(foreignWrite.status).toBe(401);
    expect(await snapshotB()).toEqual(bSiteBaseline);
    for (const [instance, name] of [
      [a, "Secret A draft zh-Hant"],
      [b, "Published B zh-Hant"],
    ] as const) {
      const recipient = `published-mail-${instance.letter}-${run}@example.invalid`;
      expect(
        (await post(instance, "register", { email: recipient })).status,
      ).toBe(202);
      let found: { ID: string; Subject: string } | undefined;
      await expect
        .poll(
          async () => {
            found = (await messages(instance, recipient)).find((m) =>
              m.Subject.includes("Verify email"),
            );
            return !!found;
          },
          { timeout: 20000 },
        )
        .toBe(true);
      const captured = await (
        await fetch(`${instance.env.MAILPIT_URL}/api/v1/message/${found!.ID}`)
      ).json();
      expect(captured.Subject).toContain(name);
      expect(captured.Text).toContain(`${instance.origin}/auth/verify#token=`);
    }
    await pa.goto(`${a.origin}/zh-Hant/home`);
    await pa.screenshot({ path: `${directory}/site-a.png`, fullPage: true });
    await pb.goto(`${b.origin}/en/home`);
    await pb.screenshot({ path: `${directory}/site-b.png`, fullPage: true });
    record(
      "Same image A/B publish independent multilingual initial HTML and canonical URLs; A draft/publish/history restore leaves B site/accounts/roles/audit and container IDs unchanged; foreign admin preview/publication denied; new worker/Mailpit mail uses each official brand without rebuilding",
    );
    const privateAssets = [];
    for (const [page, instance] of [
      [pa, a],
      [pb, b],
    ] as const) {
      const configuration = await (
        await page.request.get(`${instance.origin}/api/submissions/config`)
      ).json();
      await sitePost(page, instance, "/api/submissions/config", {
        ...configuration,
        opensAt: new Date(Date.now()-60*60*1000).toISOString(),
        closesAt: new Date(Date.now()+24*60*60*1000).toISOString(),
        requireRegistration: false,
        requireAttachment: true,
        mode: "abstract",
        presenterMustBeSubmitter: false,
        tracks: [{ id: "isolation", name: "Synthetic isolation", topics: [] }],
      });
      const asset = await sitePost(page, instance, "/api/files", {
        purpose: "manuscript",
        name: `synthetic-${instance.letter}.png`,
        content:
          "iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVQImWP4DwYMEAoAU7oL9W/sIDEAAAAASUVORK5CYII=",
      });
      expect(asset.status).toBe("ready");
      const draft = await sitePost(page, instance, "/api/submissions/save", {
        id: randomUUID(),
        expectedVersion: 0,
        document: {
          title: "Synthetic private submission",
          abstract: "Synthetic isolation verification manuscript",
          keywords: [],
          correspondingAuthorIndex: 0,
          trackId: "isolation",
          topicIds: [],
          authors: [
            {
              name: "Synthetic Author",
              email: "author@example.invalid",
              affiliation: "Synthetic Institute",
            },
          ],
          presenterIndex: 0,
          presentationPreference: "oral",
          competition: false,
          attachmentIds: [asset.id],
          slidesFileId: null,
          videoUrl: "",
        },
      });
      const submitted = await sitePost(
        page,
        instance,
        "/api/submissions/transition",
        {
          id: draft.id,
          expectedVersion: draft.version,
          action: "submit",
        },
      );
      expect(submitted.state).toBe("submitted");
      expect(
        (
          await instance.db.query(
            "SELECT resource_id FROM confsys.file_references WHERE file_id=$1 AND resource_type='submission_revision'",
            [asset.id],
          )
        ).rows.map((row) => row.resource_id),
      ).toContain(submitted.currentRevisionId);
      expect(
        (
          await page.request.get(
            `${instance.origin}/api/files/${asset.id}/download`,
          )
        ).status(),
      ).toBe(200);
      expect(
        (
          await page.request.get(`${instance.origin}/api/media/${asset.id}`)
        ).status(),
      ).toBe(404);
      privateAssets.push({ id: asset.id, submissionId: submitted.id });
    }
    for (const [page, instance, foreign] of [
      [pa, a, privateAssets[1]!],
      [pb, b, privateAssets[0]!],
    ] as const) {
      expect(
        (
          await page.request.get(
            `${instance.origin}/api/files/${foreign.id}/download`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (
          await page.request.get(
            `${instance.origin}/api/submissions/detail?id=${foreign.submissionId}&scope=own`,
          )
        ).status(),
      ).toBe(404);
      expect(
        (
          await instance.db.query(
            "SELECT id FROM confsys.file_assets WHERE id=$1",
            [foreign.id],
          )
        ).rows,
      ).toHaveLength(0);
      expect(
        (
          await instance.db.query(
            "SELECT file_id FROM confsys.file_references WHERE file_id=$1",
            [foreign.id],
          )
        ).rows,
      ).toHaveLength(0);
    }
    expect(
      (
        await localFetch(
          `${b.origin}/api/files/${privateAssets[0]!.id}/download`,
          { headers: { cookie: `dev-session=${newCookieA.value}` } },
        )
      ).status,
    ).toBe(401);
    record(
      "Both instances scan real private uploads and submit immutable attachment revisions; own downloads work, public access and cross-instance sessions/files/submission references are denied",
    );
    evidence.checks = checks;
    if (options["restore-fixtures"]) {
      evidence.restoreFixtures = { status: "running" };
      writeFileSync(
        `${directory}/evidence.json`,
        JSON.stringify(evidence, null, 2),
      );
      try {
        // Finish B's own submission mail before comparing unrelated A writes.
        // Preserve the exact audit snapshot assertion; asynchronous B work is
        // legitimate and must not be mistaken for cross-instance mutation.
        await expect.poll(async () => Number((await b.db.query(
          "SELECT count(*) FROM confsys.notifications WHERE status IN ('pending','processing')",
        )).rows[0].count), { timeout: 30000 }).toBe(0);
        const beforeRestoreFixturesB = await snapshotB();
        await sitePost(pa, a, "/api/auth/reauthenticate", { password: newA });
        evidence.restoreFixtures = await enrichRestoreFixtures({
          run,
          envFile: a.file,
          project: a.env.COMPOSE_PROJECT_NAME!,
          origin: a.origin,
          image,
          imageId: String(evidence.imageId),
          page: pa,
          db: a.db,
          stopWorker: () => a.compose("--profile", "app", "stop", "worker"),
        });
        expect(await snapshotB()).toEqual(beforeRestoreFixturesB);
        record(
          "Restore fixtures generated by real A APIs and worker: confirmed free registration, private QR, ready badge PDF and CSV, pending encrypted mail; only A worker intentionally stopped, B unchanged",
        );
      } catch (error) {
        evidence.restoreFixtures = {
          status: "failed",
          errorType: error instanceof Error ? error.name : "Unknown failure",
        };
        writeFileSync(
          `${directory}/evidence.json`,
          JSON.stringify(evidence, null, 2),
        );
        throw error;
      }
    }
    await pa.goto(`${a.origin}/auth/login`);
    await expect(
      pa.getByRole("heading", {
        name: "登入 Secret A draft zh-Hant",
        exact: true,
      }),
    ).toBeVisible();
    await pa.screenshot({ path: `${directory}/a.png`, fullPage: true });
    await pb.screenshot({ path: `${directory}/b.png`, fullPage: true });
    evidence.checks = checks;
    writeFileSync(
      `${directory}/evidence.json`,
      JSON.stringify(evidence, null, 2),
    );
    console.log(
      `Evidence: ${directory}/evidence.json. Synthetic resources retained; cleanup requires this run's explicit env files.`,
    );
  }
} catch (error) {
  writeFileSync(
    `${directory}/failure.json`,
    JSON.stringify(
      {
        run,
        image,
        checks,
        errorType: error instanceof Error ? error.name : "Unknown failure",
      },
      null,
      2,
    ),
  );
  throw error;
} finally {
  await Promise.all(
    reservations
      .filter((s) => s.listening)
      .map((s) => new Promise<void>((done) => s.close(() => done()))),
  );
  await browser?.close();
  await Promise.all(instances.map((i) => i.db.end()));
}

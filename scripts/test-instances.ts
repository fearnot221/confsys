import { promisify } from "node:util";
import { execFile, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { randomUUID } from "node:crypto";
import { chromium, expect, type Page } from "@playwright/test";
import { createPool } from "@confsys/db";
import { localFetch } from "./local-http.js";

// Own fresh resources only. No global cleanup and no reuse of user volumes.
const run = randomUUID().slice(0, 8);
const image = `confsys:p12-${run}`;
const directory = `.instances/${run}`;
mkdirSync(directory, { recursive: true });
const evidence: Record<string, unknown> = { run, image, checks: [] };
const checks: string[] = [];
const record = (value: string) => {
  checks.push(value);
  console.log(value);
};
function command(args: string[], env: NodeJS.ProcessEnv = process.env) {
  execFileSync(process.execPath, args, { env, stdio: "inherit" });
}
const instances = ["a", "b"].map((letter, i) => {
  const file = `${directory}/${letter}.env`;
  const origin = `http://${letter}.localhost:${45173 + i}`;
  command(
    ["--conditions=development", "--import", "tsx", "scripts/setup.mjs"],
    {
      ...process.env,
      CONFSYS_ENV_FILE: file,
      COMPOSE_PROJECT_NAME: `confsys-p12-${run}-${letter}`,
      APP_IMAGE: image,
      PUBLIC_APP_ORIGIN: origin,
      CONFERENCE_NAME: `Synthetic Conference ${letter.toUpperCase()}`,
      WEB_PORT: String(45173 + i),
      POSTGRES_PORT: String(45432 + i),
      REDIS_PORT: String(46379 + i),
      MAILPIT_PORT: String(48025 + i),
      SMTP_PORT: String(41025 + i),
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
    db: createPool(env.MIGRATION_DATABASE_URL!, 1),
  };
});
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
      `SELECT jsonb_build_object('users',(SELECT jsonb_agg(u) FROM confsys.users u),'sessions',(SELECT jsonb_agg(jsonb_build_object('id',s.id,'token_hash',s.token_hash,'revoked_at',s.revoked_at)) FROM confsys.sessions s),'roles',(SELECT jsonb_agg(r) FROM confsys.user_roles r),'bootstrap',(SELECT jsonb_agg(c) FROM confsys.access_control c),'audit',(SELECT count(*) FROM confsys.auth_audit),'migrations',(SELECT jsonb_agg(m) FROM confsys.schema_migrations m)) AS state`,
    )
  ).rows[0].state;
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
try {
  a.compose("--profile", "app", "build", "api");
  for (const instance of instances) {
    instance.compose("up", "-d", "--wait", "postgres", "redis", "mailpit");
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
      expect(mount.Destination).toBe("/docker-entrypoint-initdb.d/01-roles.sh");
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
    const dto = await localFetch(`${instance.origin}/api/instance`).then((r) =>
      r.json(),
    );
    expect(dto).toEqual({ conferenceName: instance.env.CONFERENCE_NAME });
    const html = await localFetch(instance.origin).then((r) => r.text());
    for (const asset of html.matchAll(/(?:src|href)="([^" ]+\.(?:js|css))"/g)) {
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
  expect((await post(b, "login", { email, password: passA })).status).toBe(401);
  expect((await post(a, "login", { email, password: passB })).status).toBe(401);
  await login(pa, a, email, passA);
  await login(pb, b, email, passB);
  const cookies = await context.cookies();
  const sa = cookies.find(
      (c) => c.name === "dev-session" && c.domain === "a.localhost",
    )!,
    sb = cookies.find(
      (c) => c.name === "dev-session" && c.domain === "b.localhost",
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
  expect((await post(a, "login", { email, password: passA })).status).toBe(401);
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
    (c) => c.name === "dev-session" && c.domain === "a.localhost",
  )!;
  expect(
    (
      await localFetch(`${b.origin}/api/access/accounts`, {
        headers: { cookie: `dev-session=${cookieA.value}` },
      })
    ).status,
  ).toBe(401);
  expect(
    (await b.db.query("SELECT count(*) FROM confsys.user_roles")).rows[0].count,
  ).toBe("0");
  expect(
    (await b.db.query("SELECT initialized_user_id FROM confsys.access_control"))
      .rows[0].initialized_user_id,
  ).toBeNull();
  const managedEmail = `managed-${run}@example.invalid`;
  expect((await post(a, "register", { email: managedEmail })).status).toBe(202);
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
  await pa.goto(`${a.origin}/auth/login`);
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
} finally {
  await browser?.close();
  await Promise.all(instances.map((i) => i.db.end()));
}

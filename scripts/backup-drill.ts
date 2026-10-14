import { parseArgs, parseEnv } from "node:util";
import { resolve, relative, dirname, basename } from "node:path";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  statSync,
  lstatSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { randomUUID, createHash } from "node:crypto";
import { createPool, withIdentityTransaction } from "@confsys/db";
const { values } = parseArgs({
  options: {
    "source-env": { type: "string" },
    "validate-only": { type: "boolean", default: false },
  },
});
if (!values["source-env"])
  throw new Error("Explicit --source-env .instances/<run>/a.env required");
const sourceFile = resolve(values["source-env"]),
  sourceRelative = relative(resolve(".instances"), sourceFile);
if (!/^[a-f0-9]{8}\/[ab]\.env$/.test(sourceRelative))
  throw new Error("Only a generated synthetic two-instance env may be used");
if (!lstatSync(sourceFile).isFile() || lstatSync(sourceFile).isSymbolicLink())
  throw new Error("Source env must be a regular file");
if ((statSync(sourceFile).mode & 0o077) !== 0)
  throw new Error("Source env must remain private");
const sourceEnv = parseEnv(readFileSync(sourceFile, "utf8")),
  sourceRun = basename(dirname(sourceFile)),
  letter = basename(sourceFile, ".env"),
  sourceProject = `confsys-p6-${sourceRun}-${letter}`;
if (sourceEnv.COMPOSE_PROJECT_NAME !== sourceProject)
  throw new Error("Source project identity differs");
const evidence = JSON.parse(
  readFileSync(resolve(dirname(sourceFile), "evidence.json"), "utf8"),
) as { run: string; imageId: string; checks: string[] };
if (
  evidence.run !== sourceRun ||
  !evidence.checks.some((value) =>
    value.includes("Both instances scan real private uploads"),
  )
)
  throw new Error("Completed full-stack isolation evidence required");
function docker(args: string[], input?: Buffer) {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 120000,
    maxBuffer: 16 * 1024 * 1024,
    ...(input ? { input } : {}),
  });
}
type Container = {
  Id: string;
  Image: string;
  State: { Running: boolean };
  NetworkSettings: {
    Ports: Record<string, { HostIp: string; HostPort: string }[] | null>;
  };
  Config: { Labels: Record<string, string> };
  Mounts: { Type: string; Name?: string; Destination: string }[];
};
const ids = docker([
  "ps",
  "-aq",
  "--filter",
  `label=com.docker.compose.project=${sourceProject}`,
])
  .trim()
  .split("\n")
  .filter(Boolean);
if (!ids.length) throw new Error("No matching synthetic source containers");
const containers = JSON.parse(docker(["inspect", ...ids])) as Container[];
const byService = (name: string) => {
  const rows = containers.filter(
    (c) => c.Config.Labels["com.docker.compose.service"] === name,
  );
  if (rows.length !== 1) throw new Error(`Expected one source ${name}`);
  return rows[0]!;
};
const api = byService("api"),
  worker = byService("worker"),
  postgres = byService("postgres");
if (api.State.Running || worker.State.Running || !postgres.State.Running)
  throw new Error(
    "Caller must first pause this synthetic source API and worker; keep its PostgreSQL running",
  );
if (api.Image !== evidence.imageId)
  throw new Error("Source app image differs from tested evidence");
const storage = api.Mounts.find(
  (m) => m.Type === "volume" && m.Destination === "/data/private",
)?.Name;
if (!storage) throw new Error("Source private volume missing");
const labels = JSON.parse(docker(["volume", "inspect", storage]))[0].Labels;
if (labels["com.docker.compose.project"] !== sourceProject)
  throw new Error("Private volume belongs to another project");
if (values["validate-only"]) {
  console.log(
    "Verified completed synthetic source identity, private volume, immutable image and paused writers; no backup or restore created",
  );
  process.exit(0);
}
const run = randomUUID().slice(0, 8),
  project = `confsys-drill-${run}`,
  directory = resolve(".restore-drills", run),
  backup = resolve(directory, "backup"),
  files = resolve(backup, "private"),
  targetFile = resolve(directory, "restore.env");
mkdirSync(resolve(".restore-drills"), { recursive: true, mode: 0o700 });
mkdirSync(directory, { mode: 0o700 });
mkdirSync(backup, { mode: 0o700 });
mkdirSync(files, { mode: 0o700 });
for (const resource of ["container", "volume", "network"])
  if (
    docker([
      resource,
      "ls",
      "-q",
      "--filter",
      `label=com.docker.compose.project=${project}`,
    ]).trim()
  )
    throw new Error("Refusing existing restore resources");
writeFileSync(resolve(backup, "source.env"), readFileSync(sourceFile), {
  flag: "wx",
  mode: 0o600,
});
const databaseUrl = new URL(sourceEnv.MIGRATION_DATABASE_URL!);
if (
  databaseUrl.hostname !== "127.0.0.1" ||
  databaseUrl.pathname !== "/confsys" ||
  databaseUrl.username !== "confsys_migrator" ||
  databaseUrl.port !== sourceEnv.POSTGRES_PORT ||
  !postgres.NetworkSettings.Ports["5432/tcp"]?.some(
    (binding) =>
      binding.HostIp === "127.0.0.1" && binding.HostPort === databaseUrl.port,
  )
)
  throw new Error(
    "Source database URL must match this synthetic container loopback port",
  );
const sourceDb = createPool(databaseUrl.toString(), 1);
const dump = resolve(backup, "database.dump");
let destinationDb: ReturnType<typeof createPool> | undefined,
  appDb: ReturnType<typeof createPool> | undefined;
const report: Record<string, unknown> = {
  run,
  sourceProject,
  project,
  startedAt: new Date().toISOString(),
  checks: [],
};
const checks: string[] = [];
const record = (message: string) => {
  checks.push(message);
  console.log(message);
};
const portServer = createServer();
await new Promise<void>((accept, reject) => {
  portServer.once("error", reject);
  portServer.listen(0, "127.0.0.1", accept);
});
const address = portServer.address();
if (!address || typeof address === "string") throw new Error("No restore port");
const copyScript = resolve("scripts/private-volume-copy.mjs");
function copyVolume(mode: "backup" | "restore", volume: string) {
  const args = [
    "run",
    "--rm",
    "--network",
    "none",
    "--read-only",
    "--user",
    "0:0",
    "--cap-drop",
    "ALL",
    "--cap-add",
    "DAC_OVERRIDE",
    "--cap-add",
    "CHOWN",
    "--security-opt",
    "no-new-privileges",
    "--memory",
    "256m",
    "--mount",
    `type=bind,src=${copyScript},dst=/copy.mjs,readonly`,
    "--mount",
    `type=bind,src=${resolve("scripts/private-volume-copy.ts")},dst=/private-volume-copy.ts,readonly`,
  ];
  if (mode === "backup")
    args.push(
      "--mount",
      `type=volume,src=${volume},dst=/source,readonly`,
      "--mount",
      `type=bind,src=${files},dst=/destination`,
    );
  else
    args.push(
      "--mount",
      `type=bind,src=${files},dst=/source,readonly`,
      "--mount",
      `type=volume,src=${volume},dst=/destination`,
    );
  return JSON.parse(
    docker([
      ...args,
      api.Image,
      "node",
      "/copy.mjs",
      mode,
      String(mode === "backup" ? process.getuid!() : 1000),
      String(mode === "backup" ? process.getgid!() : 1000),
    ]),
  );
}
async function snapshot(db: ReturnType<typeof createPool>) {
  const assets = (
    await db.query(
      "SELECT id,owner_id,storage_key::text,size_bytes,sha256,status FROM confsys.file_assets ORDER BY id",
    )
  ).rows;
  const refs = (
    await db.query(
      "SELECT file_id,resource_type,resource_id FROM confsys.file_references ORDER BY file_id,resource_type,resource_id",
    )
  ).rows;
  const migrations = (
    await db.query("SELECT * FROM confsys.schema_migrations ORDER BY version")
  ).rows;
  const generated = [];
  for (const [table, column] of [
    ["document_jobs", "pdf"],
    ["export_jobs", "csv"],
  ] as const) {
    const rows = (
      await db.query(
        `SELECT id,octet_length(${column}) AS size,sha256 FROM confsys.${table} WHERE ${column} IS NOT NULL ORDER BY id LIMIT 1001`,
      )
    ).rows;
    if (
      rows.length > 1000 ||
      rows.reduce((sum, row) => sum + Number(row.size), 0) > 1024 * 1024 * 1024
    )
      throw new Error("Generated artifacts exceed bounded drill size");
    for (const row of rows) {
      const bytes = (
        await db.query(
          `SELECT ${column} AS bytes FROM confsys.${table} WHERE id=$1`,
          [row.id],
        )
      ).rows[0].bytes;
      if (
        !Buffer.isBuffer(bytes) ||
        createHash("sha256").update(bytes).digest("hex") !== row.sha256
      )
        throw new Error("Generated artifact integrity failure");
      generated.push({
        kind: table,
        id: row.id,
        sha256: row.sha256,
        size: bytes.length,
      });
    }
  }
  const tables = (
    await db.query(
      "SELECT tablename FROM pg_tables WHERE schemaname='confsys' ORDER BY tablename",
    )
  ).rows;
  const counts = [];
  for (const row of tables) {
    if (!/^[a-z][a-z0-9_]*$/.test(row.tablename))
      throw new Error("Unexpected table identifier");
    counts.push({
      table: row.tablename,
      count: (
        await db.query(
          `SELECT count(*)::text AS count FROM confsys.${row.tablename}`,
        )
      ).rows[0].count,
    });
  }
  const sequences = (
    await db.query(
      "SELECT sequencename,last_value::text FROM pg_sequences WHERE schemaname='confsys' ORDER BY sequencename",
    )
  ).rows;
  return { assets, refs, migrations, generated, counts, sequences };
}
try {
  const before = await snapshot(sourceDb);
  if (
    !before.assets.some((row) => row.status === "ready") ||
    !before.refs.length
  )
    throw new Error(
      "Synthetic source must include actual ready referenced files",
    );
  if (
    before.refs.some(
      (ref) =>
        !before.assets.some(
          (asset) => asset.id === ref.file_id && asset.status === "ready",
        ),
    )
  )
    throw new Error("A private reference does not target a ready file");
  const fd = openSync(dump, "wx", 0o600);
  try {
    execFileSync(
      "docker",
      [
        "exec",
        postgres.Id,
        "pg_dump",
        "-U",
        "postgres",
        "-d",
        "confsys",
        "--format=custom",
        "--no-owner",
      ],
      { stdio: ["ignore", fd, "pipe"], timeout: 120000 },
    );
  } finally {
    closeSync(fd);
  }
  report.dumpSha256 = createHash("sha256")
    .update(readFileSync(dump))
    .digest("hex");
  const copied = copyVolume("backup", storage);
  const manifest = JSON.parse(
    readFileSync(resolve(files, "manifest.json"), "utf8"),
  ) as { key: string; size: number; sha256: string }[];
  for (const asset of before.assets.filter((row) => row.status === "ready")) {
    const file = manifest.find((item) => item.key === asset.storage_key);
    if (!file || file.size !== asset.size_bytes || file.sha256 !== asset.sha256)
      throw new Error("Ready file does not match DB checksum");
  }
  if (JSON.stringify(await snapshot(sourceDb)) !== JSON.stringify(before))
    throw new Error(
      "Source changed during consistent backup; keep writers paused",
    );
  record(
    "Created consistent database dump and verified all ready private file checksums plus stored generated artifact bytes",
  );
  execFileSync(
    process.execPath,
    ["--conditions=development", "--import", "tsx", "scripts/setup.mjs"],
    {
      env: {
        ...process.env,
        CONFSYS_ENV_FILE: targetFile,
        COMPOSE_PROJECT_NAME: project,
        APP_IMAGE: api.Image,
        POSTGRES_PORT: String(address.port),
        PUBLIC_APP_ORIGIN: "http://127.0.0.1:59999",
        PRIVATE_STORAGE_ROOT: resolve(directory, "private"),
      },
      stdio: "pipe",
    },
  );
  const destinationEnv = parseEnv(readFileSync(targetFile, "utf8"));
  for (const key of [
    "MAIL_KEY_VERSION",
    "MAIL_ENCRYPTION_KEY",
    "CSRF_SIGNING_KEY",
    "QR_SIGNING_KEY",
  ]) {
    if (!sourceEnv[key]) throw new Error(`Missing recovery setting ${key}`);
    destinationEnv[key] = sourceEnv[key];
  }
  writeFileSync(
    targetFile,
    Object.entries(destinationEnv)
      .map(([key, value]) => `${key}=${JSON.stringify(value)}`)
      .join("\n") + "\n",
    { mode: 0o600 },
  );
  await new Promise<void>((accept, reject) =>
    portServer.close((error) => (error ? reject(error) : accept())),
  );
  execFileSync(
    process.execPath,
    [
      "--conditions=development",
      "--import",
      "tsx",
      "scripts/compose.mjs",
      "up",
      "-d",
      "--wait",
      "postgres",
    ],
    {
      env: { ...process.env, CONFSYS_ENV_FILE: targetFile },
      stdio: "pipe",
      timeout: 120000,
    },
  );
  const targetId = docker([
    "ps",
    "-q",
    "--filter",
    `label=com.docker.compose.project=${project}`,
    "--filter",
    "label=com.docker.compose.service=postgres",
  ]).trim();
  if (!targetId) throw new Error("Restore PostgreSQL missing");
  const target = JSON.parse(docker(["inspect", targetId]))[0] as Container;
  if (target.Image !== postgres.Image)
    throw new Error("Restore PostgreSQL image differs from source");
  destinationDb = createPool(destinationEnv.MIGRATION_DATABASE_URL!, 1);
  if (
    (await destinationDb.query("SELECT to_regnamespace('confsys') AS schema"))
      .rows[0].schema !== null
  )
    throw new Error("Refusing nonempty restore database");
  const input = openSync(dump, "r");
  try {
    execFileSync(
      "docker",
      [
        "exec",
        "-i",
        targetId,
        "pg_restore",
        "-U",
        "confsys_migrator",
        "-d",
        "confsys",
        "--no-owner",
        "--exit-on-error",
        "--single-transaction",
      ],
      { stdio: [input, "pipe", "pipe"], timeout: 120000 },
    );
  } finally {
    closeSync(input);
  }
  const volume = `${project}_private-storage`;
  if (docker(["volume", "ls", "-q", "--filter", `name=^${volume}$`]).trim())
    throw new Error("Refusing existing restore private volume");
  docker([
    "volume",
    "create",
    "--label",
    `com.docker.compose.project=${project}`,
    "--label",
    "com.docker.compose.volume=private-storage",
    volume,
  ]);
  const restored = copyVolume("restore", volume);
  if (
    JSON.stringify(restored) !== JSON.stringify(copied) ||
    JSON.stringify(await snapshot(destinationDb)) !== JSON.stringify(before)
  )
    throw new Error("Restored snapshot or file inventory differs");
  record(
    "Restored into fresh isolated PostgreSQL and new private volume; snapshots/references/generated PDFs/exports are identical",
  );
  appDb = createPool(destinationEnv.DATABASE_URL!, 1);
  const roles = (
    await appDb.query(
      "SELECT rolname,rolsuper,rolbypassrls FROM pg_roles WHERE rolname IN('confsys_app','confsys_worker') ORDER BY rolname",
    )
  ).rows;
  if (
    roles.length !== 2 ||
    roles.some((row) => row.rolsuper || row.rolbypassrls)
  )
    throw new Error("Restored runtime roles bypass RLS");
  const role = (await appDb.query("SELECT current_user AS role")).rows[0].role;
  if (role !== "confsys_app")
    throw new Error("Runtime verification did not use actual app login");
  if (
    (await appDb.query("SELECT id FROM confsys.file_assets")).rows.length ||
    (await appDb.query("SELECT file_id FROM confsys.file_references")).rows
      .length
  )
    throw new Error("Missing context does not deny private data");
  const selected = before.assets.find(
    (row) =>
      row.status === "ready" &&
      before.refs.some((ref) => ref.file_id === row.id),
  )!;
  await withIdentityTransaction(appDb, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [randomUUID()]);
    if (
      (
        await db.query("SELECT id FROM confsys.file_assets WHERE id=$1", [
          selected.id,
        ])
      ).rows.length
    )
      throw new Error("Foreign owner sees restored private file");
    if (
      (
        await db.query(
          "SELECT file_id FROM confsys.file_references WHERE file_id=$1",
          [selected.id],
        )
      ).rows.length
    )
      throw new Error("Foreign owner sees restored private reference");
  });
  await withIdentityTransaction(appDb, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [
      selected.owner_id,
    ]);
    if (
      (
        await db.query("SELECT id FROM confsys.file_assets WHERE id=$1", [
          selected.id,
        ])
      ).rows.length !== 1
    )
      throw new Error("Owner cannot access restored private file");
    if (
      (
        await db.query(
          "SELECT file_id FROM confsys.file_references WHERE file_id=$1",
          [selected.id],
        )
      ).rows.length !==
      before.refs.filter((ref) => ref.file_id === selected.id).length
    )
      throw new Error("Owner cannot access restored private references");
  });
  if ((await appDb.query("SELECT id FROM confsys.file_assets")).rows.length)
    throw new Error("Transaction context leaked to pooled connection");
  record(
    "Actual app login denies missing/foreign context, allows owner, and clears context; app/worker remain NOSUPERUSER NOBYPASSRLS",
  );
  report.status = "passed";
  report.fileCount = manifest.length;
  report.referenceCount = before.refs.length;
  report.generatedArtifactCount = before.generated.length;
  report.tableCounts = before.counts;
  report.sequenceCount = before.sequences.length;
  report.privateVolume = volume;
} catch (error) {
  report.status = "failed";
  report.errorType = error instanceof Error ? error.name : "UnknownError";
  throw error;
} finally {
  if (portServer.listening)
    await new Promise<void>((done) => portServer.close(() => done()));
  await Promise.all([sourceDb.end(), destinationDb?.end(), appDb?.end()]);
  report.completedAt = new Date().toISOString();
  report.checks = checks;
  writeFileSync(
    resolve(directory, "evidence.json"),
    JSON.stringify(report, null, 2),
    { mode: 0o600, flag: "wx" },
  );
  console.log(
    `Restore drill checkpoint: ${relative(process.cwd(), directory)}/evidence.json; own resources retained, no worker/mail started, source untouched`,
  );
}

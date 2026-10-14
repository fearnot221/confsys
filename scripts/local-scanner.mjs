// Local macOS development helper. Never installs system files or changes Docker settings.
import { createHash, randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import { gzipSync } from "node:zlib";
import { spawn, spawnSync } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readFile,
  writeFile,
  cp,
  readdir,
  access,
  rename,
  rm,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { userInfo } from "node:os";
import { parseArgs, parseEnv } from "node:util";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
const version = "1.5.4",
  packageHash =
    "df7fa753e2f9f67f3bc99b2a40a3be7ef559088c68ad6bdf66b4b5764e965bd6";
const url = `https://www.clamav.net/downloads/production/clamav-${version}.macos.universal.pkg`;
const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    package: { type: "string" },
    port: { type: "string" },
    host: { type: "string" },
  },
});
const command = positionals[0];
if (
  positionals.length !== 1 ||
  !["prepare", "update", "run", "check"].includes(command)
)
  throw new Error(
    "Usage: node scripts/local-scanner.mjs prepare [--package verified.pkg] | update | run | check [--port N]",
  );
let env = {};
try {
  env = parseEnv(
    await readFile(process.env.CONFSYS_ENV_FILE ?? ".env", "utf8"),
  );
} catch (e) {
  if (e.code !== "ENOENT") throw e;
}
const port = Number(
    values.port ?? process.env.CLAMAV_PORT ?? env.CLAMAV_PORT ?? 3310,
  ),
  host =
    values.host ?? process.env.CLAMAV_HOST ?? env.CLAMAV_HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("Use an unprivileged local scanner port");
if (!["127.0.0.1", "localhost", "host.docker.internal"].includes(host))
  throw new Error("Only loopback/Docker Desktop host scanner is allowed");
const root = resolve(".tools", `scanner-${version}`),
  runtime = join(root, "runtime"),
  database = join(root, "database"),
  manifestPath = join(root, "manifest.json");
if (/[\r\n]/.test(root))
  throw new Error("Unsupported newline in workspace path");
async function sha(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}
function run(binary, args) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      `${binary} failed: ${result.stderr || result.stdout || result.error?.message}`,
    );
  return result.stdout;
}
async function verifyRuntime() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.version !== version || manifest.packageSha256 !== packageHash)
    throw new Error("Scanner manifest mismatch");
  for (const [path, hash] of Object.entries(manifest.binaries)) {
    if ((await sha(join(runtime, path))) !== hash)
      throw new Error("Scanner runtime integrity mismatch");
  }
  return manifest;
}
async function configure() {
  await mkdir(database, { recursive: true, mode: 0o700 });
  await writeFile(
    join(root, "clamd.conf"),
    `Foreground yes\nTCPSocket ${port}\nTCPAddr 127.0.0.1\nDatabaseDirectory ${database}\nTemporaryDirectory ${root}\nLogFile ${join(root, "clamd.log")}\nLogTime yes\nMaxThreads 2\nMaxConnectionQueueLength 10\nStreamMaxLength 10M\nMaxScanSize 40M\nMaxFileSize 10M\nAlertExceedsMax yes\nAlertEncrypted yes\nConcurrentDatabaseReload no\nCVDCertsDirectory ${join(runtime, "etc/certs")}\n`,
    { mode: 0o600 },
  );
  await writeFile(
    join(root, "freshclam.conf"),
    `DatabaseDirectory ${database}\nDatabaseOwner ${userInfo().username}\nDatabaseMirror database.clamav.net\nDNSDatabaseInfo current.cvd.clamav.net\nCVDCertsDirectory ${join(runtime, "etc/certs")}\nUpdateLogFile ${join(root, "freshclam.log")}\nForeground yes\n`,
    { mode: 0o600 },
  );
}
async function prepare() {
  if (process.platform !== "darwin")
    throw new Error(
      "Native helper supports macOS only; use pinned Compose ClamAV on Linux",
    );
  try {
    await access(manifestPath);
    await verifyRuntime();
    console.log(`Verified existing local ClamAV ${version}`);
    return;
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  const pkg = join(root, `clamav-${version}.pkg`);
  if (values.package) {
    await cp(resolve(values.package), pkg, {
      errorOnExist: true,
      force: false,
    });
  } else {
    try {
      await access(pkg);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      const response = await fetch(url, {
        signal: AbortSignal.timeout(180000),
      });
      if (!response.ok || !response.body)
        throw new Error("Official scanner package download failed", {
          cause: e,
        });
      const partial = `${pkg}.${randomUUID()}.partial`;
      let bytes = 0;
      try {
        await pipeline(
          Readable.fromWeb(response.body),
          new Transform({
            transform(chunk, _encoding, callback) {
              bytes += chunk.length;
              callback(
                bytes > 200 * 1024 * 1024
                  ? new Error("Package exceeds download bound")
                  : null,
                chunk,
              );
            },
          }),
          createWriteStream(partial, { flags: "wx", mode: 0o600 }),
        );
        await rename(partial, pkg);
      } finally {
        await rm(partial, { force: true });
      }
    }
  }
  if ((await sha(pkg)) !== packageHash)
    throw new Error("Official package checksum mismatch; nothing executed");
  const signature = run("/usr/sbin/pkgutil", ["--check-signature", pkg]);
  if (
    !signature.includes("Developer ID Installer: Cisco (DE8Y96K9QP)") ||
    !signature.includes("trusted by the Apple notary service")
  )
    throw new Error("Expected trusted Cisco notarized package signature");
  const expanded = join(root, `expanded-${randomUUID()}`),
    staging = join(root, `runtime-${randomUUID()}`);
  await mkdir(staging, { mode: 0o700 });
  try {
    run("/usr/sbin/pkgutil", ["--expand-full", pkg, expanded]);
    for (const entry of await readdir(expanded)) {
      if (!entry.endsWith(".pkg")) continue;
      const payload = join(expanded, entry, "Payload/usr/local/clamav");
      try {
        await access(payload);
        await cp(payload, staging, { recursive: true, verbatimSymlinks: true });
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
    }
    await mkdir(database, { recursive: true, mode: 0o700 });
    const verificationConfig = join(root, "verification.conf");
    await writeFile(verificationConfig, `DatabaseDirectory ${database}\n`, {
      mode: 0o600,
    });
    const binaries = {};
    for (const relative of ["sbin/clamd", "bin/freshclam"]) {
      const file = join(staging, relative);
      run("/usr/bin/install_name_tool", [
        "-add_rpath",
        "@executable_path/../lib",
        file,
      ]);
      run("/usr/bin/codesign", ["--force", "--sign", "-", file]);
      if (
        !run(file, [
          "--version",
          `--config-file=${verificationConfig}`,
        ]).startsWith(`ClamAV ${version}`)
      )
        throw new Error("Unexpected extracted engine version");
      binaries[relative] = await sha(file);
    }
    await rename(staging, runtime);
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          version,
          packageSha256: packageHash,
          source: url,
          binaries,
          localRelocation:
            "Executable-relative dylib rpath; local ad-hoc signature after upstream verification",
        },
        null,
        2,
      ) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  } finally {
    await rm(expanded, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
  await configure();
  console.log(
    `Prepared verified ClamAV ${version} inside ${root}. Next: update, then run.`,
  );
}
function exchange(chunks) {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port });
    let result = "";
    const finish = (error) => {
      socket.destroy();
      if (error) reject(error);
      else resolve(result.replace(/\0.*$/s, ""));
    };
    socket.setTimeout(10000);
    socket.once("timeout", () => finish(new Error("Scanner timeout")));
    socket.once("error", finish);
    socket.once("connect", () => {
      for (const chunk of chunks) socket.write(chunk);
    });
    socket.on("data", (chunk) => {
      result += chunk.toString();
      if (result.length > 4096)
        finish(new Error("Unexpected scanner response"));
      else if (result.includes("\0") || result.includes("\n")) finish();
    });
    socket.once("end", () => {
      if (!result) finish(new Error("Empty scanner response"));
    });
  });
}
function scan(bytes) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return exchange([Buffer.from("zINSTREAM\0"), length, bytes, Buffer.alloc(4)]);
}
async function check() {
  if ((await exchange([Buffer.from("zPING\0")])) !== "PONG")
    throw new Error("Scanner did not answer PONG");
  const engine = await exchange([Buffer.from("zVERSION\0")]);
  if (!engine.startsWith(`ClamAV ${version}/`))
    throw new Error("Unexpected engine or missing signature database");
  if (
    (await scan(Buffer.from("Confsys synthetic clean scanner check"))) !==
    "stream: OK"
  )
    throw new Error("Clean sample was not scanned successfully");
  const eicar = Buffer.from(
    "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*",
  );
  if (!(await scan(eicar)).endsWith(" FOUND"))
    throw new Error("EICAR detection failed");
  const oversizedArchive = gzipSync(Buffer.alloc(11 * 1024 * 1024));
  if (!(await scan(oversizedArchive)).includes("Heuristics.Limits.Exceeded"))
    throw new Error(
      "Scanner did not reject partial scans exceeding resource limits; enable AlertExceedsMax",
    );
  console.log(
    `${engine}\nReal scanner ready: PING, clean INSTREAM, EICAR and scan-limit rejection passed.`,
  );
}
if (command === "prepare") await prepare();
else if (command === "check") await check();
else {
  if (process.platform !== "darwin")
    throw new Error("Native helper supports macOS only");
  await verifyRuntime();
  await configure();
  if (command === "update")
    console.log(
      run(join(runtime, "bin/freshclam"), [
        `--config-file=${join(root, "freshclam.conf")}`,
      ]),
    );
  else {
    await access(join(database, "main.cvd"));
    const child = spawn(
      join(runtime, "sbin/clamd"),
      [`--config-file=${join(root, "clamd.conf")}`],
      { stdio: "inherit" },
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, () => child.kill(signal));
    const code = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    process.exitCode = code;
  }
}

import { spawn } from "node:child_process";
import { loadApiConfig, loadWorkerConfig } from "@confsys/config";
const [service, mode] = process.argv.slice(2);
if (service !== "api" && service !== "worker")
  throw new Error("Expected api or worker");
const config = service === "api" ? loadApiConfig() : loadWorkerConfig();
const env = Object.fromEntries(
  Object.entries(config).map(([key, value]) => [key, String(value)]),
);
// Child processes receive only validated role-specific config and runtime essentials.
for (const key of ["PATH", "HOME", "TMPDIR", "FORCE_COLOR"])
  if (process.env[key]) env[key] = process.env[key];
const args =
  mode === "dev"
    ? [
        "--watch",
        "--conditions=development",
        "--import",
        "tsx",
        `apps/${service}/src/main.ts`,
      ]
    : [`apps/${service}/dist/main.js`];
const child = spawn(process.execPath, args, { env, stdio: "inherit" });
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => child.kill(signal));
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

import { loadLocalConfig } from "@confsys/config";
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
const file = process.env.CONFSYS_ENV_FILE ?? ".env";
const env = parseEnv(readFileSync(file, "utf8"));
loadLocalConfig(env);
const result = spawnSync(
  "docker",
  [
    "compose",
    "--env-file",
    file,
    "--project-name",
    env.COMPOSE_PROJECT_NAME,
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env: { ...process.env, ...env } },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);

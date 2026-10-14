import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { loadLocalConfig } from "@confsys/config";
it("setup preserves existing instance name, credentials and secrets on rerun", async () => {
  const dir = await mkdtemp(join(tmpdir(), "confsys-setup-test-"));
  const file = join(dir, "instance.env");
  try {
    const env = {
      ...process.env,
      CONFSYS_ENV_FILE: file,
      COMPOSE_PROJECT_NAME: "confsys-setup-test",
      APP_IMAGE: "confsys:test",
      CONFERENCE_NAME: "Synthetic test",
    };
    const run = () =>
      execFileSync(
        process.execPath,
        ["--conditions=development", "--import", "tsx", "scripts/setup.mjs"],
        { env, encoding: "utf8" },
      );
    const output = run();
    const first = await readFile(file, "utf8");
    const values = parseEnv(first);
    run();
    expect((await readFile(file, "utf8")) === first).toBe(true);
    expect(values.CONFERENCE_NAME).toBe("Synthetic test");
    for (const key of [
      "CSRF_SIGNING_KEY",
      "MAIL_ENCRYPTION_KEY",
      "APP_PASSWORD",
      "WORKER_PASSWORD",
    ]) {
      expect(values[key]!.length).toBeGreaterThanOrEqual(48);
      expect(output.includes(values[key]!)).toBe(false);
    }
    expect(values.APP_PASSWORD === values.WORKER_PASSWORD).toBe(false);
  } finally {
    await rm(dir, { recursive: true });
  }
});
it("local tooling rejects invalid deployment selector, unversioned image, port and nonlocal capture URL", () => {
  const env = { COMPOSE_PROJECT_NAME: "synthetic", APP_IMAGE: "confsys:test" };
  for (const override of [
    { COMPOSE_PROJECT_NAME: "../other" },
    { APP_IMAGE: "confsys" },
    { WEB_PORT: "0" },
    { MAILPIT_URL: "http://external.invalid" },
    { MAILPIT_URL: "malformed" },
  ])
    expect(() => loadLocalConfig({ ...env, ...override })).toThrow(
      "Invalid environment fields",
    );
});

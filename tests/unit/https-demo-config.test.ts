import { it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  chmodSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

it("validates public demo configuration, persists identity and never executes env content", () => {
  const dir = mkdtempSync(join(tmpdir(), "https-demo-config-"));
  const file = join(dir, "demo.env");
  const run = (domain: string, overrides = {}) =>
    execFileSync(
      "sh",
      [
        "-c",
        '. "$1"; config_file=$2; load_config; save_config; printf "%s" "$DEMO_ORIGIN"',
        "config-test",
        resolve("deploy/https-demo/config.sh"),
        file,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          PATH: process.env.PATH,
          DEMO_DOMAIN: domain,
          ...overrides,
        },
      },
    );
  try {
    for (const invalid of [
      "",
      "http://demo.example.com",
      "demo.example.com/path",
      "demo.example.com:443",
      "*.example.com",
      "127.0.0.1",
      "a.localhost",
      "example.test",
      "a..com",
      "-a.com",
      "a-.com",
      "A.com",
      "demo.example.com\nother.example.com",
      `${"a".repeat(64)}.com`,
    ]) {
      expect(() => run(invalid)).toThrow();
      expect(existsSync(file)).toBe(false);
    }
    for (const overrides of [
      { DEMO_MAIL_PORT: "80" },
      { DEMO_MAIL_PORT: "99999" },
      { DEMO_PROJECT_NAME: "../other" },
      { COMPOSE_PROFILES: "unknown" },
    ])
      expect(() => run("demo.example.com", overrides)).toThrow();
    expect(run("demo.example.com")).toBe("https://demo.example.com");
    const saved = readFileSync(file, "utf8");
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(run("demo.example.com")).toBe("https://demo.example.com");
    expect(readFileSync(file, "utf8")).toBe(saved);
    expect(() => run("other.example.com")).toThrow();
    expect(() =>
      run("demo.example.com", { DEMO_PROJECT_NAME: "other" }),
    ).toThrow();
    expect(readFileSync(file, "utf8")).toBe(saved);
    const marker = join(dir, "executed");
    writeFileSync(file, `DEMO_DOMAIN=$(touch ${marker})\n`);
    expect(() => run("demo.example.com")).toThrow();
    expect(existsSync(marker)).toBe(false);
    writeFileSync(file, "UNEXPECTED=value\n");
    expect(() => run("demo.example.com")).toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("HTTPS check rejects redirects and curl certificate failures instead of reporting readiness", () => {
  const dir = mkdtempSync(join(tmpdir(), "https-demo-check-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const docker = join(bin, "docker"),
    curl = join(bin, "curl");
  writeFileSync(
    docker,
    '#!/bin/sh\ncase "$*" in "compose version --short") echo 2.35.1 ;; esac\n',
  );
  chmodSync(docker, 0o700);
  const run = () =>
    execFileSync("sh", [resolve("deploy/https-demo/demo.sh"), "check"], {
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        CONFSYS_ENV_FILE: join(dir, "demo.env"),
        DEMO_DOMAIN: "demo.example.com",
      },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  try {
    for (const response of ["echo 301", "echo 000; exit 60"]) {
      writeFileSync(curl, `#!/bin/sh\n${response}\n`);
      chmodSync(curl, 0o700);
      expect(() => run()).toThrow();
    }
    writeFileSync(curl, "#!/bin/sh\necho 200\n");
    expect(() => run()).not.toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

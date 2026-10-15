import { it, expect, afterEach } from "vitest";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, rmSync, chmodSync } from "node:fs";
import { resolve } from "node:path";
import { assertRestoreFixtureTarget } from "../../scripts/restore-fixtures.js";
const created: string[] = [];
afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true });
});
function fixture() {
  const run = randomUUID().slice(0, 8),
    directory = resolve(".instances", run);
  mkdirSync(resolve(".instances"), { recursive: true });
  mkdirSync(directory, { mode: 0o700 });
  created.push(directory);
  const target = {
    run,
    envFile: resolve(directory, "a.env"),
    project: `confsys-p6-${run}-a`,
    origin: `http://a-${run}.localhost:49999`,
    image: "confsys:synthetic-fixture",
    imageId: `sha256:${"a".repeat(64)}`,
  };
  writeFileSync(
    target.envFile,
    `COMPOSE_PROJECT_NAME=${target.project}\nPUBLIC_APP_ORIGIN=${target.origin}\nAPP_IMAGE=${target.image}\n`,
    { mode: 0o600, flag: "wx" },
  );
  return target;
}
it("rejects other projects, B instance and non-immutable image before any Docker operation", () => {
  const target = fixture();
  expect(() =>
    assertRestoreFixtureTarget({ ...target, project: "confsys-existing" }),
  ).toThrow("this run A");
  expect(() =>
    assertRestoreFixtureTarget({
      ...target,
      project: `confsys-p6-${target.run}-b`,
    }),
  ).toThrow("this run A");
  expect(() =>
    assertRestoreFixtureTarget({ ...target, imageId: "confsys:mutable" }),
  ).toThrow("this run A");
});
it("rejects mismatched env origin/image and permissive credential file before Docker", () => {
  const target = fixture();
  expect(() =>
    assertRestoreFixtureTarget({
      ...target,
      origin: `http://b-${target.run}.localhost:49999`,
    }),
  ).toThrow("identity mismatch");
  expect(() =>
    assertRestoreFixtureTarget({ ...target, image: "confsys:different" }),
  ).toThrow("identity mismatch");
  chmodSync(target.envFile, 0o644);
  expect(() => assertRestoreFixtureTarget(target)).toThrow("0600");
});
it("rejects arbitrary environment files outside this generated run", () => {
  const target = fixture();
  expect(() =>
    assertRestoreFixtureTarget({ ...target, envFile: resolve(".env") }),
  ).toThrow("path mismatch");
});

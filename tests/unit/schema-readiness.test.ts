import { expect, it } from "vitest";
import { readdir } from "node:fs/promises";
import { REQUIRED_SCHEMA_VERSION } from "@confsys/db";
it("readiness requires the current migration before accepting application traffic", async () => {
  const versions = (await readdir("packages/db/migrations")).filter(name => name.endsWith(".sql")).sort();
  expect(REQUIRED_SCHEMA_VERSION).toBe(versions.at(-1));
});

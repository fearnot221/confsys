import { it, expect } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
it("boundary checker accepts absent folders/UI imports and rejects relative, alias and re-export escapes", async () => {
  const root = await mkdtemp(join(tmpdir(), "confsys-boundaries-"));
  try {
    for (const dir of [
      "packages/ui/src",
      "packages/contracts/src",
      "apps/web/src/features/auth/hooks",
      "apps/web/src/features/auth/components",
      "apps/web/src/features/empty",
    ])
      await mkdir(join(root, dir), { recursive: true });
    await writeFile(
      join(root, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@hidden/*": ["apps/web/src/features/auth/hooks/*"] },
        },
      }),
    );
    await writeFile(
      join(root, "packages/ui/src/part.ts"),
      "export const value=1;",
    );
    await writeFile(
      join(root, "packages/ui/src/index.ts"),
      "export * from './part.js';",
    );
    await writeFile(
      join(root, "apps/web/src/features/auth/hooks/data.ts"),
      "export const data=1;",
    );
    const check = async () => {
      const runner = join(root, "check.mjs");
      await writeFile(
        runner,
        `import {checkBoundaries} from ${JSON.stringify(new URL("../../scripts/check-boundaries.mjs", import.meta.url).href)}; console.log(JSON.stringify(checkBoundaries(${JSON.stringify(root)})));`,
      );
      return JSON.parse(
        execFileSync(process.execPath, [runner], { encoding: "utf8" }),
      );
    };
    expect(await check()).toEqual([]);
    await writeFile(
      join(root, "apps/web/src/features/auth/components/screen.ts"),
      "export * from '../hooks/data.js'; import {data} from '@hidden/data';",
    );
    await writeFile(
      join(root, "packages/contracts/src/index.ts"),
      "export * from '../../db/src/index.js';",
    );
    expect(await check()).toHaveLength(3);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("clean build removes stale compiled modules while preserving unrelated files", async () => {
  const root = await mkdtemp(join(tmpdir(), "confsys-build-"));
  try {
    await mkdir(join(root, "apps/api/src"), { recursive: true });
    await mkdir(join(root, "packages/example/src"), { recursive: true });
    const source = join(root, "apps/api/src/deleted.ts");
    await writeFile(source, "export const oldRoute = true;");
    const tsc = resolve("node_modules/typescript/bin/tsc");
    execFileSync(
      process.execPath,
      [
        tsc,
        source,
        "--outDir",
        join(root, "dist/apps/api/src"),
        "--skipLibCheck",
      ],
      { cwd: root },
    );
    await mkdir(join(root, "apps/api/dist"));
    await writeFile(join(root, "apps/api/dist/deleted.js"), "old");
    await writeFile(join(root, "notes.txt"), "preserve");
    await rm(source);
    execFileSync(process.execPath, [resolve("scripts/clean-build.mjs")], {
      cwd: root,
    });
    await writeFile(
      join(root, "apps/api/src/current.ts"),
      "export const currentRoute = true;",
    );
    execFileSync(
      process.execPath,
      [
        tsc,
        join(root, "apps/api/src/current.ts"),
        "--outDir",
        join(root, "dist/apps/api/src"),
        "--skipLibCheck",
      ],
      { cwd: root },
    );
    await expect(
      access(join(root, "dist/apps/api/src/deleted.js")),
    ).rejects.toThrow();
    await expect(
      access(join(root, "apps/api/dist/deleted.js")),
    ).rejects.toThrow();
    await expect(access(join(root, "notes.txt"))).resolves.toBeUndefined();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

import { readdir, rm } from "node:fs/promises";
// Only repository-owned generated directories; never follow arbitrary paths.
await rm("dist", { recursive: true, force: true });
for (const group of ["apps", "packages"])
  for (const entry of await readdir(group, { withFileTypes: true }))
    if (entry.isDirectory())
      await rm(`${group}/${entry.name}/dist`, { recursive: true, force: true });

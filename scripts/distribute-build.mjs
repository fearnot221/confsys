import { cp, rm, readdir } from "node:fs/promises";
for (const group of ["apps", "packages"])
  for (const name of await readdir(`dist/${group}`)) {
    const destination = `${group}/${name}/dist`;
    await rm(destination, { recursive: true, force: true });
    await cp(`dist/${group}/${name}/src`, destination, { recursive: true });
  }

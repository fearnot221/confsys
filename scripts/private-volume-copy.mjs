// Container entrypoint; Node 24 native type stripping loads the dependency-free helper.
import { copyPrivateVolume } from "./private-volume-copy.ts";
const mode = process.argv[2];
if (!["backup", "restore", "verify"].includes(mode))
  throw new Error("Expected backup, restore or verify");
process.stdout.write(
  JSON.stringify(
    await copyPrivateVolume(
      mode,
      "/source",
      "/destination",
      Number(process.argv[3]),
      Number(process.argv[4]),
    ),
  ),
);

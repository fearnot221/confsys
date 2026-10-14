import { writeFile } from "node:fs/promises";
import { openApiDocument } from "@confsys/contracts";
await writeFile(
  "packages/contracts/openapi.json",
  JSON.stringify(openApiDocument(), null, 2) + "\n",
);

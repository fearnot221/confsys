import { parseArgs } from "node:util";
import { randomUUID } from "node:crypto";
import { createPool } from "@confsys/db";
import { loadBootstrapConfig } from "@confsys/config";
import { bootstrapAdministrator } from "../apps/api/src/access/bootstrap.js";
import { AuthError } from "../apps/api/src/auth/errors.js";
try {
  const { values } = parseArgs({
    options: {
      "user-id": { type: "string" },
      apply: { type: "boolean", default: false },
      reason: { type: "string" },
      "confirm-origin": { type: "string" },
    },
    strict: true,
  });
  const config = loadBootstrapConfig();
  const pool = createPool(config.MIGRATION_DATABASE_URL);
  try {
    console.log(
      JSON.stringify(
        await bootstrapAdministrator(
          pool,
          {
            conferenceName: config.CONFERENCE_NAME,
            origin: config.PUBLIC_APP_ORIGIN,
          },
          {
            targetId: values["user-id"],
            apply: values.apply,
            reason: values.reason,
            confirmOrigin: values["confirm-origin"],
          },
          randomUUID(),
        ),
      ),
    );
  } finally {
    await pool.end();
  }
} catch (error) {
  console.error(
    JSON.stringify({
      event: "bootstrap_failed",
      code:
        error instanceof AuthError
          ? error.code
          : "INVALID_INPUT_OR_DATABASE_FAILURE",
    }),
  );
  process.exitCode = 1;
}

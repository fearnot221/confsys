import { createPool } from "@confsys/db";
import { loadWorkerConfig } from "@confsys/config";
import {
  createMailSender,
  processNotification,
} from "@confsys/notifications/worker";
const config = loadWorkerConfig();
if (new URL(config.WORKER_DATABASE_URL).pathname !== "/confsys_test")
  throw new Error("Test DB required");
const pool = createPool(config.WORKER_DATABASE_URL);
const sender = createMailSender(config);
await processNotification(pool, config, process.argv[2]!, async (mail) => {
  const accepted = await sender.send(mail);
  process.send?.({ event: "smtp_accepted" });
  // Deterministic fault seam: parent kills this real process after SMTP acceptance,
  // before processNotification can commit accepted. No production fault switch.
  await new Promise<void>(() => {});
  return accepted;
});

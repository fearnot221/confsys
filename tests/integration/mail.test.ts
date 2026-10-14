import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Queue, QueueEvents } from "bullmq";
import { redisOptions } from "@confsys/config";
import {
  processNotification,
  recoverNotifications,
  dispatchNotifications,
  startMailWorker,
} from "@confsys/notifications/worker";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { authFixture } from "../helpers/auth.js";
const f = authFixture(),
  service = createAuthService(f.app, f.config);
const name = `mail-test-${randomUUID()}`;
const queue = new Queue(name, { connection: redisOptions(f.config.REDIS_URL) });
const events = new QueueEvents(name, {
  connection: redisOptions(f.config.REDIS_URL),
});
const noSend = async () => ({ messageId: "synthetic-accepted" });
async function pending() {
  const email = f.email();
  await service.requestMail("register", email, randomUUID());
  return { email, ...(await f.link(email)) };
}
async function status(id: string) {
  return (
    await f.admin.query(
      "SELECT status,result_code,attempts FROM confsys.notifications WHERE id=$1",
      [id],
    )
  ).rows[0];
}
beforeAll(async () => {
  f.migrate();
  await events.waitUntilReady();
});
afterAll(async () => {
  await events.close();
  await queue.obliterate({ force: true });
  await queue.close();
  await f.cleanup();
});
it("durable pending survives queue delay and real independent BullMQ consumer sends through Mailpit", async () => {
  const notification = await pending();
  expect((await status(notification.id)).status).toBe("pending");
  // Queue is paused while dispatcher commits its enqueue; provider cannot be called yet.
  await queue.pause();
  await dispatchNotifications(f.worker, queue);
  const job = await queue.getJob(notification.id);
  expect(job?.data).toEqual({ eventId: notification.id });
  const worker = startMailWorker(f.worker, f.workerConfig, name);
  try {
    await worker.worker.waitUntilReady();
    expect((await status(notification.id)).status).toBe("pending");
    await queue.resume();
    await expect
      .poll(async () => (await status(notification.id)).status)
      .toBe("accepted");
    const result = await fetch(
      `${process.env.MAILPIT_URL ?? "http://127.0.0.1:28025"}/api/v1/search?query=${encodeURIComponent(`to:${notification.email}`)}`,
    ).then((r) => r.json());
    expect(result.messages.length).toBe(1);
    const detail = await fetch(
      `${process.env.MAILPIT_URL ?? "http://127.0.0.1:28025"}/api/v1/message/${result.messages[0].ID}`,
    ).then((r) => r.json());
    expect(detail.Text).toContain(notification.link);
    expect(
      (
        await f.admin.query(
          "SELECT * FROM confsys.notification_secrets WHERE notification_id=$1",
          [notification.id],
        )
      ).rowCount,
    ).toBe(0);
    await queue.add(
      "mail",
      { eventId: notification.id },
      { removeOnComplete: true },
    );
    await expect.poll(async () => queue.getActiveCount()).toBe(0);
    expect((await status(notification.id)).attempts).toBe(1);
  } finally {
    await worker.close();
  }
});
it("duplicate concurrent claims send once; expired/ineligible jobs never send", async () => {
  const first = await pending();
  let calls = 0;
  const send = async () => {
    calls++;
    return noSend();
  };
  await Promise.all([
    processNotification(f.worker, f.workerConfig, first.id, send),
    processNotification(f.worker, f.workerConfig, first.id, send),
  ]);
  expect(calls).toBe(1);
  const expired = await pending();
  await f.admin.query(
    "UPDATE confsys.notifications SET expires_at=now()-interval '1 second' WHERE id=$1",
    [expired.id],
  );
  await processNotification(f.worker, f.workerConfig, expired.id, send);
  expect(calls).toBe(1);
  expect((await status(expired.id)).status).toBe("cancelled");
  const revoked = await pending();
  await f.admin.query(
    "UPDATE confsys.auth_tokens SET revoked_at=now() WHERE id=(SELECT token_id FROM confsys.notifications WHERE id=$1)",
    [revoked.id],
  );
  await processNotification(f.worker, f.workerConfig, revoked.id, send);
  expect(calls).toBe(1);
  expect((await status(revoked.id)).status).toBe("cancelled");
});
it("leases recover pre-send crashes, retain uncertain sends, and retry known connection failures with same token", async () => {
  const claimed = await pending(),
    sending = await pending();
  await f.admin.query(
    "UPDATE confsys.notifications SET status='processing',stage='claimed',lease_until=now()-interval '1 second' WHERE id=$1",
    [claimed.id],
  );
  await f.admin.query(
    "UPDATE confsys.notifications SET status='processing',stage='sending',lease_until=now()-interval '1 second' WHERE id=$1",
    [sending.id],
  );
  await recoverNotifications(f.worker);
  expect((await status(claimed.id)).status).toBe("pending");
  expect((await status(sending.id)).status).toBe("unknown");
  await processNotification(f.worker, f.workerConfig, claimed.id, async () => {
    throw Object.assign(new Error("do not log smtp secrets"), {
      code: "ECONNECTION",
      command: "CONN",
    });
  });
  expect((await status(claimed.id)).status).toBe("pending");
  expect((await f.link(claimed.email)).token).toBe(claimed.token);
  await f.admin.query(
    "UPDATE confsys.notifications SET next_attempt_at=now() WHERE id=$1",
    [claimed.id],
  );
  await processNotification(f.worker, f.workerConfig, claimed.id, noSend);
  expect((await status(claimed.id)).status).toBe("accepted");
  const uncertain = await pending();
  await processNotification(
    f.worker,
    f.workerConfig,
    uncertain.id,
    async () => {
      throw new Error("SMTP may have accepted");
    },
  );
  expect((await status(uncertain.id)).status).toBe("unknown");
  const audit = await f.admin.query(
    "SELECT * FROM confsys.auth_audit WHERE event_id=ANY($1::uuid[])",
    [[sending.id, uncertain.id]],
  );
  expect(JSON.stringify(audit.rows)).not.toMatch(/SMTP may|smtp secrets/);
  expect(audit.rowCount).toBe(2);
});
it("real worker process crash after Mailpit acceptance becomes unknown and is never blindly resent", async () => {
  const { fork } = await import("node:child_process");
  const notification = await pending();
  const child = fork("tests/helpers/mail-crash.ts", [notification.id], {
    execArgv: ["--conditions=development", "--import", "tsx"],
    silent: true,
    env: {
      PATH: process.env.PATH,
      ...Object.fromEntries(
        Object.entries(f.workerConfig).map(([k, v]) => [k, String(v)]),
      ),
    },
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Crash fixture SMTP timeout")),
        10000,
      );
      child.once("message", (message) => {
        clearTimeout(timer);
        if (
          message &&
          typeof message === "object" &&
          "event" in message &&
          message.event === "smtp_accepted"
        )
          resolve();
        else reject(new Error("Unexpected crash event"));
      });
      child.once("exit", () => {
        clearTimeout(timer);
        reject(new Error("Crash fixture exited before acceptance"));
      });
    });
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => child.once("exit", () => resolve()));
    expect((await status(notification.id)).status).toBe("processing");
    await f.admin.query(
      "UPDATE confsys.notifications SET lease_until=now()-interval '1 second' WHERE id=$1",
      [notification.id],
    );
    await recoverNotifications(f.worker);
    expect((await status(notification.id)).status).toBe("unknown");
    let called = false;
    await processNotification(
      f.worker,
      f.workerConfig,
      notification.id,
      async () => {
        called = true;
        return noSend();
      },
    );
    expect(called).toBe(false);
    const mail = await fetch(
      `${process.env.MAILPIT_URL ?? "http://127.0.0.1:28025"}/api/v1/search?query=${encodeURIComponent(`to:${notification.email}`)}`,
    ).then((r) => r.json());
    expect(mail.messages).toHaveLength(1);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
}, 20000);

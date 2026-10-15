import { beforeAll, afterAll, it, expect, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { withIdentityTransaction } from "@confsys/db";
import { enqueueBusinessNotification } from "@confsys/notifications";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import {
  processNotification,
  createMailSender,
} from "../../packages/notifications/src/worker.js";
const f = authFixture(),
  auth = createAuthService(f.app, f.config);
const rid = () => randomUUID();
async function active() {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const session = await auth.login(email, password, rid());
  return { id: session.account.user.id, email };
}
beforeAll(() => f.migrate());
afterAll(() => f.cleanup());
it("business outbox deduplicates an event and worker sends real Mailpit message without token secrets", async () => {
  const recipient = await active(),
    eventKey = `synthetic:${rid()}`;
  const input = {
    userId: recipient.id,
    eventKey,
    subject: "Synthetic registration recorded",
    text: `Please sign in to ${f.config.PUBLIC_APP_ORIGIN}/auth/account to view your record.`,
    requestId: rid(),
  };
  await withIdentityTransaction(f.app, async (db) => {
    await enqueueBusinessNotification(db, f.config, input);
    await enqueueBusinessNotification(db, f.config, input);
  });
  const rows = (
    await f.admin.query<{ id: string }>(
      "SELECT id FROM confsys.notifications WHERE event_key=$1",
      [eventKey],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  const id = rows[0]!.id;
  expect(
    (
      await f.admin.query(
        "SELECT * FROM confsys.notification_secrets WHERE notification_id=$1",
        [id],
      )
    ).rows,
  ).toHaveLength(0);
  const sender = createMailSender(f.workerConfig);
  try {
    await processNotification(f.worker, f.workerConfig, id, sender.send);
    await processNotification(f.worker, f.workerConfig, id, sender.send);
  } finally {
    sender.close();
  }
  expect(
    (
      await f.admin.query(
        "SELECT status,attempts FROM confsys.notifications WHERE id=$1",
        [id],
      )
    ).rows[0],
  ).toEqual({ status: "accepted", attempts: 1 });
  const result = await fetch(
    `${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${recipient.email}`)}`,
  ).then((r) => r.json());
  const matches = result.messages.filter((m: { Subject: string }) =>
    m.Subject.includes(input.subject),
  );
  expect(matches).toHaveLength(1);
  const message = await fetch(
    `${process.env.MAILPIT_URL}/api/v1/message/${matches[0].ID}`,
  ).then((r) => r.json());
  expect(message.Text).toContain(input.text);
  expect(message.Text).not.toContain("token=");
});
it("business event rolls back with its caller transaction and disabled recipients are not sent mail", async () => {
  const recipient = await active(),
    eventKey = `synthetic:${rid()}`;
  const input = {
    userId: recipient.id,
    eventKey,
    subject: "Synthetic status updated",
    text: "Sign in to view your record.",
    requestId: rid(),
  };
  await expect(
    withIdentityTransaction(f.app, async (db) => {
      await enqueueBusinessNotification(db, f.config, input);
      throw new Error("synthetic rollback");
    }),
  ).rejects.toThrow("synthetic rollback");
  expect(
    (
      await f.admin.query(
        "SELECT id FROM confsys.notifications WHERE event_key=$1",
        [eventKey],
      )
    ).rows,
  ).toHaveLength(0);
  await withIdentityTransaction(f.app, (db) =>
    enqueueBusinessNotification(db, f.config, input),
  );
  const id = (
    await f.admin.query(
      "SELECT id FROM confsys.notifications WHERE event_key=$1",
      [eventKey],
    )
  ).rows[0].id;
  await f.admin.query("UPDATE confsys.users SET state='disabled' WHERE id=$1", [
    recipient.id,
  ]);
  const sender = createMailSender(f.workerConfig);
  try {
    await processNotification(f.worker, f.workerConfig, id, sender.send);
  } finally {
    sender.close();
  }
  expect(
    (
      await f.admin.query(
        "SELECT status FROM confsys.notifications WHERE id=$1",
        [id],
      )
    ).rows[0].status,
  ).toBe("cancelled");
  const result = await fetch(
    `${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${recipient.email}`)}`,
  ).then((r) => r.json());
  expect(
    result.messages.filter((m: { Subject: string }) =>
      m.Subject.includes(input.subject),
    ),
  ).toHaveLength(0);
});

it("worker resolves the recipient again at its authorization boundary after a mailbox change", async () => {
  const recipient = await active();
  const session = await auth.login(recipient.email, password, rid());
  const target = f.email();
  await auth.requestEmailChange(session.raw, target, rid());
  const change = await f.link(recipient.email, "email_change");
  const eventKey = `synthetic:${rid()}`;
  const subject = `Synthetic mailbox race ${rid()}`;
  await withIdentityTransaction(f.app, (db) =>
    enqueueBusinessNotification(db, f.config, {
      userId: recipient.id,
      eventKey,
      subject,
      text: "Private current-account status.",
      requestId: rid(),
    }),
  );
  const id = (
    await f.admin.query(
      "SELECT id FROM confsys.notifications WHERE event_key=$1",
      [eventKey],
    )
  ).rows[0].id;
  const originalQuery = f.worker.query.bind(f.worker);
  let changed = false;
  // Coordinate real transactions after the initial eligibility read and before
  // the access fence. Persistence and SMTP remain actual PG/Mailpit operations.
  const interceptedQuery = new Proxy(originalQuery, {
    async apply(fn, receiver, args) {
      const result = await Reflect.apply(fn, receiver, args);
      if (
        !changed &&
        typeof args[0] === "string" &&
        args[0].includes("SELECT e.email,e.eligible,s.ciphertext")
      ) {
        changed = true;
        await auth.confirmEmailChange(
          session.raw,
          { token: change.token },
          rid(),
        );
      }
      return result;
    },
  });
  const query = vi
    .spyOn(f.worker, "query")
    .mockImplementation(interceptedQuery);
  const sender = createMailSender(f.workerConfig);
  try {
    await processNotification(f.worker, f.workerConfig, id, sender.send);
  } finally {
    query.mockRestore();
    sender.close();
  }
  expect(changed).toBe(true);
  for (const [email, count] of [
    [recipient.email, 0],
    [target, 1],
  ] as const) {
    const result = await fetch(
      `${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
    ).then((r) => r.json());
    expect(
      result.messages.filter((m: { Subject: string }) =>
        m.Subject.includes(subject),
      ),
    ).toHaveLength(count);
  }
});

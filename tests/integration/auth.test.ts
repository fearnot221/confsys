import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { withIdentityTransaction, assertRuntimeRole } from "@confsys/db";
import {
  createAuthService,
  tokenHash,
} from "../../apps/api/src/auth/service.js";
import { verifyPassword } from "../../apps/api/src/auth/password.js";
import { authFixture, password, replacement } from "../helpers/auth.js";
const f = authFixture();
let now = new Date();
const service = createAuthService(f.app, f.config, { now: () => now });
const requestId = () => randomUUID();
async function active() {
  const email = f.email();
  await service.requestMail("register", email, requestId());
  const { token } = await f.link(email);
  await service.consume("verify", token, password, requestId());
  return email;
}
beforeAll(() => f.migrate());
afterAll(() => f.cleanup());
it("concurrent and duplicate registration preserves unique identity and credentials", async () => {
  const email = f.email();
  await Promise.all([
    service.requestMail("register", email.toUpperCase(), requestId()),
    service.requestMail("register", email, requestId()),
  ]);
  const before = await f.admin.query(
    "SELECT * FROM confsys.users WHERE email=$1",
    [email],
  );
  expect(before.rowCount).toBe(1);
  expect(before.rows[0].password_hash).toBeNull();
  const { token } = await f.link(email);
  await service.consume("verify", token, password, requestId());
  const state = (
    await f.admin.query("SELECT * FROM confsys.users WHERE email=$1", [email])
  ).rows[0];
  await service.requestMail("register", email, requestId());
  expect(
    (await f.admin.query("SELECT * FROM confsys.users WHERE email=$1", [email]))
      .rows[0],
  ).toEqual(state);
  await expect(
    service.consume("verify", token, replacement, requestId()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  await expect(
    service.login(email, password, requestId()),
  ).resolves.toHaveProperty("account.user.email", email);
});
it("token purpose, expiry, disabled users, reuse and concurrent consumption are denied", async () => {
  const email = f.email();
  await service.requestMail("register", email, requestId());
  const first = await f.link(email);
  await expect(
    service.consume("reset", first.token, password, requestId()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  await f.admin.query(
    "UPDATE confsys.auth_tokens SET expires_at=$2 WHERE token_hash=$1",
    [tokenHash(first.token), new Date(now.getTime() - 1)],
  );
  await expect(
    service.consume("verify", first.token, password, requestId()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  await service.requestMail("resend", email, requestId());
  const next = await f.link(email);
  const results = await Promise.allSettled([
    service.consume("verify", next.token, password, requestId()),
    service.consume("verify", next.token, password, requestId()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await service.requestMail("forgot", email, requestId());
  const reset = await f.link(email, "reset");
  await f.admin.query(
    "UPDATE confsys.users SET state='disabled' WHERE email=$1",
    [email],
  );
  await expect(
    service.consume("reset", reset.token, replacement, requestId()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  await expect(
    service.login(email, password, requestId()),
  ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
});
it("reset atomically revokes sessions and sibling tokens; no automatic login", async () => {
  const email = await active();
  const old = await service.login(email, password, requestId());
  await service.requestMail("forgot", email, requestId());
  const first = await f.link(email, "reset");
  await service.requestMail("forgot", email, requestId());
  const second = await f.link(email, "reset");
  await service.consume("reset", second.token, replacement, requestId());
  await expect(service.me(old.raw)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  await expect(
    service.login(email, password, requestId()),
  ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  await expect(
    service.consume("reset", first.token, password, requestId()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  const sessions = await f.admin.query(
    "SELECT count(*) FROM confsys.sessions s JOIN confsys.users u ON s.user_id=u.id WHERE u.email=$1 AND revoked_at IS NULL",
    [email],
  );
  expect(sessions.rows[0].count).toBe("0");
  await expect(
    service.login(email, replacement, requestId()),
  ).resolves.toHaveProperty("account.user.email", email);
});
it("login verified before reset cannot create a session after credential version changes", async () => {
  const email = await active();
  await service.requestMail("forgot", email, requestId());
  const { token } = await f.link(email, "reset");
  let resume!: () => void, verified!: () => void;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    verified = resolve;
  });
  const racing = createAuthService(f.app, f.config, {
    verify: async (hash, value) => {
      const valid = await verifyPassword(hash, value);
      verified();
      await gate;
      return valid;
    },
  });
  const login = racing.login(email, password, requestId());
  const outcome = expect(login).rejects.toMatchObject({
    code: "INVALID_CREDENTIALS",
  });
  await ready;
  await service.consume("reset", token, replacement, requestId());
  resume();
  await outcome;
});
it("session fixation, forged/revoked cookies, idle and absolute boundaries use server time", async () => {
  const email = await active();
  const first = await service.login(email, password, requestId()),
    second = await service.login(email, password, requestId());
  expect(first.raw).not.toBe(second.raw);
  await expect(service.me("forged")).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  await service.logout(first.raw, requestId());
  await service.logout(first.raw, requestId());
  await expect(service.me(first.raw)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  const original = now;
  try {
    now = new Date(original.getTime() + f.config.SESSION_IDLE_SECONDS * 1000);
    await expect(service.me(second.raw)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    const live = await service.login(email, password, requestId());
    await f.admin.query(
      "UPDATE confsys.sessions SET last_seen_at=$2, expires_at=$2 WHERE token_hash=$1",
      [tokenHash(live.raw), now],
    );
    await expect(service.me(live.raw)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
  } finally {
    now = original;
  }
});
it("transaction rollback leaves no partial identity, token, outbox or audit", async () => {
  const email = f.email();
  const existing = await active();
  const session = await service.login(existing, password, requestId());
  await service.requestMail("forgot", existing, requestId());
  const reset = await f.link(existing, "reset");
  await expect(
    withIdentityTransaction(f.app, async (db) => {
      await db.query("INSERT INTO confsys.users(id,email) VALUES ($1,$2)", [
        randomUUID(),
        email,
      ]);
      throw new Error("force rollback");
    }),
  ).rejects.toThrow("force rollback");
  expect(
    (
      await f.admin.query("SELECT id FROM confsys.users WHERE email=$1", [
        email,
      ])
    ).rowCount,
  ).toBe(0);
  // Deliberate failure at the outbox boundary rolls back a real registration transaction.
  await f.admin.query(
    `CREATE FUNCTION confsys.test_fail_mail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id = '${requestFailure}'::uuid THEN RAISE EXCEPTION 'synthetic outbox failure'; END IF; RETURN NEW; END $$`,
  );
  await f.admin.query(
    "CREATE TRIGGER test_mail_failure BEFORE INSERT ON confsys.notifications FOR EACH ROW EXECUTE FUNCTION confsys.test_fail_mail()",
  );
  try {
    await expect(
      service.requestMail("register", email, requestFailure),
    ).rejects.toThrow();
    expect(
      (
        await f.admin.query("SELECT id FROM confsys.users WHERE email=$1", [
          email,
        ])
      ).rowCount,
    ).toBe(0);
    await expect(
      service.consume("reset", reset.token, replacement, requestFailure),
    ).rejects.toThrow();
    await expect(service.me(session.raw)).resolves.toHaveProperty(
      "user.email",
      existing,
    );
    await expect(
      service.login(existing, password, requestId()),
    ).resolves.toHaveProperty("account.user.email", existing);
    expect(
      (
        await f.admin.query(
          "SELECT used_at FROM confsys.auth_tokens WHERE token_hash=$1",
          [tokenHash(reset.token)],
        )
      ).rows[0].used_at,
    ).toBeNull();
  } finally {
    await f.admin.query(
      "DROP TRIGGER test_mail_failure ON confsys.notifications",
    );
    await f.admin.query("DROP FUNCTION confsys.test_fail_mail()");
  }
});
const requestFailure = randomUUID();
it("real runtime roles cannot read each other's credentials or widen identity into tenant bypass", async () => {
  await assertRuntimeRole(f.app, "confsys_app");
  await assertRuntimeRole(f.worker, "confsys_worker");
  for (const table of ["users", "sessions", "auth_tokens"])
    await expect(
      f.worker.query(`SELECT * FROM confsys.${table}`),
    ).rejects.toMatchObject({ code: "42501" });
  await expect(
    f.app.query("SELECT * FROM confsys.notification_secrets"),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    f.worker.query("SET ROLE confsys_migrator"),
  ).rejects.toMatchObject({ code: "42501" });
});

it("runtime column grants prevent notification recipient reassignment and unsupported identity edits", async () => {
  await expect(
    f.worker.query(
      "UPDATE confsys.notifications SET user_id=user_id WHERE false",
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    f.worker.query(
      "UPDATE confsys.notifications SET token_id=token_id WHERE false",
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    f.app.query("UPDATE confsys.users SET email=email WHERE false"),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    f.app.query(
      "UPDATE confsys.sessions SET expires_at=expires_at WHERE false",
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    f.app.query(
      "UPDATE confsys.auth_tokens SET token_hash=token_hash WHERE false",
    ),
  ).rejects.toMatchObject({ code: "42501" });
});

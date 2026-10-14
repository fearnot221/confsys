import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { withIdentityTransaction } from "@confsys/db";
import {
  createAuthService,
  tokenHash,
} from "../../apps/api/src/auth/service.js";
import { isRevisionAuthorAccount } from "../../apps/api/src/auth/conflicts.js";
import {
  processNotification,
  createMailSender,
} from "../../packages/notifications/src/worker.js";
import { authFixture, password } from "../helpers/auth.js";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  rid = () => randomUUID();
async function active() {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  return { email, ...(await auth.login(email, password, rid())) };
}
beforeAll(() => f.migrate());
afterAll(() => f.cleanup());
it("new mailbox receives real confirmation; stable identity survives while sessions and reset tokens are revoked", async () => {
  const account = await active(),
    second = await auth.login(account.email, password, rid()),
    target = f.email();
  await auth.requestMail("forgot", account.email, rid());
  const reset = await f.link(account.email, "reset");
  await auth.requestEmailChange(account.raw, target, rid());
  const change = await f.link(account.email, "email_change");
  expect((await auth.me(account.raw)).user.email).toBe(account.email);
  const sender = createMailSender(f.workerConfig);
  try {
    await processNotification(f.worker, f.workerConfig, change.id, sender.send);
  } finally {
    sender.close();
  }
  const mail = await fetch(
    `${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${target}`)}`,
  ).then((r) => r.json());
  expect(mail.messages).toHaveLength(1);
  expect(mail.messages[0].Subject).toContain("Confirm new email");
  await auth.confirmEmailChange(account.raw, { token: change.token }, rid());
  for (const raw of [account.raw, second.raw])
    await expect(auth.me(raw)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
  await expect(
    auth.consume("reset", reset.token, password, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  const fresh = await auth.login(target, password, rid());
  expect(fresh.account.user.id).toBe(account.account.user.id);
  await expect(
    auth.login(account.email, password, rid()),
  ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  await expect(
    auth.confirmEmailChange(fresh.raw, { token: change.token }, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  const history = (
    await f.admin.query(
      "SELECT email FROM confsys.verified_email_history WHERE user_id=$1 ORDER BY email",
      [fresh.account.user.id],
    )
  ).rows.map((r) => r.email);
  expect(history).toEqual([account.email, target].sort());
  expect(
    (
      await f.admin.query(
        "SELECT event FROM confsys.auth_audit WHERE user_id=$1 AND event='email_changed'",
        [fresh.account.user.id],
      )
    ).rowCount,
  ).toBe(1);
});
it("requires recent proof, token recipient, current epoch, expiry, and free target; competing confirmation consumes once", async () => {
  const a = await active(),
    other = await active(),
    target = f.email();
  await f.admin.query(
    "UPDATE confsys.sessions SET password_verified_at=now()-interval '20 minutes' WHERE token_hash=$1",
    [tokenHash(a.raw)],
  );
  await expect(
    auth.requestEmailChange(a.raw, target, rid()),
  ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  await auth.reauthenticate(a.raw, password, rid());
  await auth.requestEmailChange(a.raw, target, rid());
  let c = await f.link(a.email, "email_change");
  await expect(
    auth.confirmEmailChange(other.raw, { token: c.token }, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  await f.admin.query(
    "UPDATE confsys.auth_tokens SET created_at=now()-interval '40 minutes',expires_at=now()-interval '10 minutes' WHERE token_hash=$1",
    [tokenHash(c.token)],
  );
  await expect(
    auth.confirmEmailChange(a.raw, { token: c.token }, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
  await auth.requestEmailChange(a.raw, target, rid());
  c = await f.link(a.email, "email_change");
  await auth.requestMail("register", target, rid());
  await expect(
    auth.confirmEmailChange(a.raw, { token: c.token }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await auth.me(a.raw)).user.email).toBe(a.email);
  const next = f.email();
  await auth.requestEmailChange(a.raw, next, rid());
  c = await f.link(a.email, "email_change");
  const results = await Promise.allSettled([
    auth.confirmEmailChange(a.raw, { token: c.token }, rid()),
    auth.confirmEmailChange(a.raw, { token: c.token }, rid()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const fresh = await auth.login(next, password, rid());
  await auth.requestEmailChange(fresh.raw, f.email(), rid());
  c = await f.link(next, "email_change");
  await f.admin.query(
    "UPDATE confsys.users SET credential_version=credential_version+1 WHERE id=$1",
    [fresh.account.user.id],
  );
  await expect(
    auth.confirmEmailChange(fresh.raw, { token: c.token }, rid()),
  ).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  const login = await auth.login(next, password, rid());
  await expect(
    auth.confirmEmailChange(login.raw, { token: c.token }, rid()),
  ).rejects.toMatchObject({ code: "INVALID_TOKEN" });
});
it("occupied addresses are generic acceptance without mail and audit failure rolls back confirmation atomically", async () => {
  const a = await active(),
    occupied = await active();
  await auth.requestEmailChange(a.raw, occupied.email, rid());
  expect(
    (
      await f.admin.query(
        "SELECT id FROM confsys.notifications WHERE user_id=$1 AND kind='email_change'",
        [a.account.user.id],
      )
    ).rowCount,
  ).toBe(0);
  await auth.requestEmailChange(a.raw, f.email(), rid());
  const c = await f.link(a.email, "email_change");
  // Real audit UUID constraint failure after mutations exercises transaction rollback.
  await expect(
    auth.confirmEmailChange(a.raw, { token: c.token }, "not-a-uuid"),
  ).rejects.toBeDefined();
  expect((await auth.me(a.raw)).user.email).toBe(a.email);
  expect(
    (
      await f.admin.query(
        "SELECT used_at FROM confsys.auth_tokens WHERE token_hash=$1",
        [tokenHash(c.token)],
      )
    ).rows[0].used_at,
  ).toBeNull();
  await auth.confirmEmailChange(a.raw, { token: c.token }, rid());
});
it("historical verified addresses only deny manuscript conflicts; app role cannot read other histories or claim author ownership", async () => {
  const coauthor = await active(),
    owner = await active(),
    other = await active(),
    submissionId = rid(),
    revisionId = rid();
  await f.admin.query(
    "INSERT INTO confsys.submissions(id,owner_id,state,version,document) VALUES($1,$2,'draft',1,$3)",
    [submissionId, owner.account.user.id, {}],
  );
  try {
    await f.admin.query(
      "INSERT INTO confsys.submission_revisions(id,submission_id,owner_id,version,document,config_snapshot) VALUES($1,$2,$3,1,$4,$5)",
      [
        revisionId,
        submissionId,
        owner.account.user.id,
        {
          authors: [
            { name: "Synthetic", email: coauthor.email, affiliation: "Test" },
          ],
        },
        {},
      ],
    );
    const target = f.email();
    await auth.requestEmailChange(coauthor.raw, target, rid());
    await auth.confirmEmailChange(
      coauthor.raw,
      { token: (await f.link(coauthor.email, "email_change")).token },
      rid(),
    );
    await withIdentityTransaction(f.app, async (db) => {
      expect(
        (await db.query("SELECT * FROM confsys.verified_email_history"))
          .rowCount,
      ).toBe(0);
      await db.query("SELECT set_config('app.actor_id',$1,true)", [
        other.account.user.id,
      ]);
      expect(
        (
          await db.query(
            "SELECT * FROM confsys.verified_email_history WHERE user_id=$1",
            [coauthor.account.user.id],
          )
        ).rowCount,
      ).toBe(0);
      expect(
        await isRevisionAuthorAccount(db, revisionId, coauthor.account.user.id),
      ).toBe(false);
      await db.query("SELECT set_config('app.actor_id',$1,true)", [
        coauthor.account.user.id,
      ]);
      expect(
        await isRevisionAuthorAccount(db, revisionId, coauthor.account.user.id),
      ).toBe(true);
      expect(
        (
          await db.query("SELECT id FROM confsys.submissions WHERE id=$1", [
            submissionId,
          ])
        ).rowCount,
      ).toBe(0);
    });
  } finally {
    await f.admin.query(
      "DELETE FROM confsys.submission_revisions WHERE id=$1",
      [revisionId],
    );
    await f.admin.query("DELETE FROM confsys.submissions WHERE id=$1", [
      submissionId,
    ]);
  }
});

it("superseded or expired mailbox requests never send and confirmation independently requires recent proof", async () => {
  const a = await active();
  await auth.requestEmailChange(a.raw, f.email(), rid());
  const first = await f.link(a.email, "email_change");
  await auth.requestEmailChange(a.raw, f.email(), rid());
  const second = await f.link(a.email, "email_change");
  await processNotification(f.worker, f.workerConfig, first.id, async () => {
    throw new Error("Revoked mailbox token must never reach transport");
  });
  expect(
    (
      await f.admin.query(
        "SELECT status FROM confsys.notifications WHERE id=$1",
        [first.id],
      )
    ).rows[0].status,
  ).toBe("cancelled");
  await f.admin.query(
    "UPDATE confsys.sessions SET password_verified_at=now()-interval '20 minutes' WHERE token_hash=$1",
    [tokenHash(a.raw)],
  );
  await expect(
    auth.confirmEmailChange(a.raw, { token: second.token }, rid()),
  ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  await auth.reauthenticate(a.raw, password, rid());
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [
      a.account.user.id,
    ]);
    await expect(
      db.query(
        "INSERT INTO confsys.verified_email_history(user_id,email) VALUES($1,$2)",
        [a.account.user.id, f.email()],
      ),
    ).rejects.toMatchObject({ code: "42501" });
  });
  await auth.confirmEmailChange(a.raw, { token: second.token }, rid());
});

it("competing accounts cannot confirm the same free mailbox or receive each others ownership", async () => {
  const a = await active(),
    b = await active(),
    target = f.email();
  await auth.requestEmailChange(a.raw, target, rid());
  await auth.requestEmailChange(b.raw, target, rid());
  const one = await f.link(a.email, "email_change"),
    two = await f.link(b.email, "email_change");
  const results = await Promise.allSettled([
    auth.confirmEmailChange(a.raw, { token: one.token }, rid()),
    auth.confirmEmailChange(b.raw, { token: two.token }, rid()),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  const winner = (await auth.login(target, password, rid())).account.user.id;
  expect([a.account.user.id, b.account.user.id]).toContain(winner);
  const loser = winner === a.account.user.id ? b : a;
  expect((await auth.me(loser.raw)).user.id).toBe(loser.account.user.id);
  expect(
    (
      await f.admin.query(
        "SELECT id FROM confsys.auth_audit WHERE event='email_changed' AND user_id=ANY($1::uuid[])",
        [[a.account.user.id, b.account.user.id]],
      )
    ).rowCount,
  ).toBe(1);
});

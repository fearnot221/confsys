import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createNotificationBatchService } from "../../apps/api/src/notification-batches/service.js";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  service = createNotificationBatchService(f.app, f.config),
  rid = () => randomUUID();
const filters = {
  role: "onsite" as const,
  registration: "any" as const,
  submission: "any" as const,
  publishedOutcome: "any" as const,
};
let raw: string, adminId: string;
const ids: string[] = [];
beforeAll(async () => {
  f.migrate();
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const login = await auth.login(email, password, rid());
  raw = login.raw;
  adminId = login.account.user.id;
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
    [adminId],
  );
  // Bounded synthetic account fixtures; application preview and outbox execute with the actual app role.
  for (let i = 0; i < 103; i++) {
    const id = rid();
    ids.push(id);
    await f.admin.query(
      "INSERT INTO confsys.users(id,email,state,password_hash,verified_at) SELECT $1,$2,'active',password_hash,clock_timestamp() FROM confsys.users WHERE id=$3",
      [
        id,
        `${f.prefix}page-${String(i).padStart(3, "0")}@example.invalid`,
        adminId,
      ],
    );
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'onsite')",
      [id],
    );
  }
});
afterAll(async () => {
  await f.admin.query(
    "DELETE FROM confsys.notifications WHERE batch_id IN(SELECT id FROM confsys.notification_batches WHERE created_by=$1)",
    [adminId],
  );
  await f.admin.query(
    "DELETE FROM confsys.notification_batches WHERE created_by=$1",
    [adminId],
  );
  await f.cleanup();
});
it("pages beyond 100 without duplicate or omitted eligible accounts and keeps each batch bounded", async () => {
  const first = await service.preview(raw, filters);
  expect(first.items).toHaveLength(100);
  expect(first.offset).toBe(0);
  expect(first.nextOffset).toBe(100);
  expect(first.truncated).toBe(true);
  const all = [...first.items];
  let offset = first.nextOffset;
  while (offset !== null) {
    expect(offset).toBeLessThan(1000);
    const page = await service.preview(raw, { ...filters, offset });
    expect(page.offset).toBe(offset);
    expect(page.items.length).toBeLessThanOrEqual(100);
    all.push(...page.items);
    offset = page.nextOffset;
  }
  expect(new Set(all.map((r) => r.id)).size).toBe(all.length);
  expect(all).toHaveLength(first.total);
  for (const id of ids) expect(all.some((r) => r.id === id)).toBe(true);
  expect(all.map((r) => r.email)).toEqual(all.map((r) => r.email).sort());
  const second = await service.preview(raw, { ...filters, offset: 100 });
  expect(second.items.length).toBeGreaterThan(0);
  const batch = await service.create(
    raw,
    {
      idempotencyKey: rid(),
      recipientIds: second.items.map((r) => r.id),
      subject: "Synthetic second page",
      text: "Verified second-page recipients",
      audience: filters,
    },
    rid(),
  );
  expect(batch.recipientCount).toBe(second.items.length);
  const recipients = (
    await f.admin.query(
      "SELECT user_id FROM confsys.notifications WHERE batch_id=$1 ORDER BY user_id",
      [batch.id],
    )
  ).rows.map((r) => r.user_id);
  expect(recipients).toEqual(second.items.map((r) => r.id).sort());
  await expect(
    service.create(
      raw,
      {
        idempotencyKey: rid(),
        recipientIds: ids.slice(0, 101),
        subject: "Over limit",
        text: "Cannot exceed batch bound",
      },
      rid(),
    ),
  ).rejects.toBeDefined();
  const bounded = await service.create(
    raw,
    {
      idempotencyKey: rid(),
      recipientIds: ids.slice(0, 100),
      subject: "Exactly bounded",
      text: "Exactly 100 synthetic recipients",
      audience: filters,
    },
    rid(),
  );
  expect(bounded.recipientCount).toBe(100);
  const empty = await service.preview(raw, { ...filters, offset: first.total });
  expect(empty.items).toEqual([]);
  expect(empty.nextOffset).toBeNull();
  await expect(
    service.preview(raw, { ...filters, offset: -1 }),
  ).rejects.toBeDefined();
});
it("rechecks changed recipients before batch creation rather than trusting the page snapshot", async () => {
  const preview = await service.preview(raw, filters),
    target = preview.items.find((r) => ids.includes(r.id))!;
  await f.admin.query("UPDATE confsys.users SET state='disabled' WHERE id=$1", [
    target.id,
  ]);
  await expect(
    service.create(
      raw,
      {
        idempotencyKey: rid(),
        recipientIds: [target.id],
        subject: "Stale selection",
        text: "Disabled recipient must not queue",
        audience: filters,
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const updated = await service.preview(raw, filters);
  expect(updated.items.some((r) => r.id === target.id)).toBe(false);
});

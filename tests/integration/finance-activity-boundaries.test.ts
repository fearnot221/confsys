import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { withIdentityTransaction } from "@confsys/db";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createRegistrationService } from "../../apps/api/src/registration/service.js";
import { createActivitiesService } from "../../apps/api/src/activities/service.js";
import { createOnsiteService } from "../../apps/api/src/onsite/service.js";
import { createFinanceService } from "../../apps/api/src/finance/service.js";
import { buildApp } from "../../apps/api/src/app.js";
import {
  registerAuthRoutes,
  cookiePolicy,
} from "../../apps/api/src/auth/routes.js";
import { registerRegistrationRoutes } from "../../apps/api/src/registration/routes.js";
import { registerActivityRoutes } from "../../apps/api/src/activities/routes.js";
import { registerFinanceRoutes } from "../../apps/api/src/finance/routes.js";
import { createRateLimiter } from "../../apps/api/src/auth/rate-limit.js";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  reg = createRegistrationService(f.app, f.config),
  activities = createActivitiesService(f.app, f.config),
  finance = createFinanceService(f.app, f.config),
  rid = () => randomUUID();
const redis = new Redis(f.config.REDIS_URL),
  namespace = `boundaries-${rid()}`,
  up = async () => {},
  app = buildApp({ postgres: up, redis: up, worker: up });
async function account(admin = false) {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const login = await auth.login(email, password, rid());
  if (admin)
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin'),($1,'finance')",
      [login.account.user.id],
    );
  return { id: login.account.user.id, email, raw: login.raw };
}
let owner: Awaited<ReturnType<typeof account>>,
  other: typeof owner,
  admin: typeof owner,
  oldVersion: number | null,
  registrationId: string,
  otherRegistration: string,
  ownerOrder: string,
  otherOrder: string;
const activityId = rid();
let csrf = "",
  csrfCookie = "";
async function post(raw: string, path: string, payload: object) {
  return app.inject({
    method: "POST",
    url: path,
    payload,
    headers: {
      origin: f.config.PUBLIC_APP_ORIGIN,
      "x-csrf-token": csrf,
      cookie: `${csrfCookie}; ${cookiePolicy(f.config).name}=${raw}`,
    },
  });
}
beforeAll(async () => {
  f.migrate();
  owner = await account();
  other = await account();
  admin = await account(true);
  oldVersion = (
    await f.admin.query("SELECT version FROM confsys.registration_state")
  ).rows[0].version;
  const ticket = rid(),
    start = new Date(Date.now() - 3600000).toISOString(),
    end = new Date(Date.now() + 7200000).toISOString();
  const configuration = await reg.configure(
    admin.raw,
    {
      expectedVersion: oldVersion ?? 0,
      document: {
        opensAt: start,
        closesAt: end,
        currency: "TWD",
        timezone: "Asia/Taipei",
        consent: "Synthetic boundaries consent",
        fields: [],
        tickets: [
          {
            id: ticket,
            name: "Synthetic boundaries",
            capacity: 10,
            waitlist: false,
            rates: [{ startsAt: start, endsAt: end, amount: "200" }],
          },
        ],
      },
    },
    rid(),
  );
  const input = () => ({
    idempotencyKey: rid(),
    configVersion: configuration.version,
    ticketId: ticket,
    badgeName: "Synthetic",
    affiliation: "Synthetic institution",
    consent: true,
    answers: {},
  });
  const a = await reg.create(owner.raw, input(), rid()),
    b = await reg.create(other.raw, input(), rid());
  registrationId = a.id;
  ownerOrder = a.order!.id;
  otherRegistration = b.id;
  otherOrder = b.order!.id;
  await activities.save(
    admin.raw,
    {
      id: activityId,
      expectedVersion: 0,
      reason: "Synthetic boundary setup",
      document: {
        name: "Synthetic boundary lunch",
        kind: "meal",
        startsAt: end,
        endsAt: new Date(Date.now() + 10800000).toISOString(),
        deadline: new Date(Date.now() + 3600000).toISOString(),
        capacity: 10,
        amount: "10",
        currency: "TWD",
        mealTypes: ["vegetarian"],
        active: true,
      },
    },
    rid(),
  );
  await registerAuthRoutes(app, {
    config: f.config,
    service: auth,
    limit: createRateLimiter(redis, f.config.CSRF_SIGNING_KEY, namespace),
  });
  registerRegistrationRoutes(app, f.config, reg);
  registerActivityRoutes(app, f.config, activities);
  registerFinanceRoutes(app, f.config, finance);
  const response = await app.inject("/api/auth/csrf");
  csrf = response.json().csrfToken;
  csrfCookie = response.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
});
afterAll(async () => {
  const users = [owner?.id, other?.id, admin?.id].filter(Boolean);
  await f.admin.query(
    "DELETE FROM confsys.onsite_redemptions WHERE actor_id=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.onsite_tokens WHERE registration_id IN(SELECT id FROM confsys.registrations WHERE user_id=ANY($1::uuid[]))",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.refunds WHERE created_by=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.payment_allocations WHERE created_by=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.payments WHERE payer_id=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.order_payers WHERE granted_by=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.activity_bookings WHERE user_id=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.order_items WHERE order_id IN(SELECT id FROM confsys.orders WHERE user_id=ANY($1::uuid[]))",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.orders WHERE user_id=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.registrations WHERE user_id=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query("DELETE FROM confsys.activities WHERE id=$1", [
    activityId,
  ]);
  await f.admin.query("DELETE FROM confsys.activity_versions WHERE id=$1", [
    activityId,
  ]);
  if (oldVersion !== undefined)
    await f.admin.query("UPDATE confsys.registration_state SET version=$1", [
      oldVersion,
    ]);
  await f.admin.query(
    "DELETE FROM confsys.registration_config_versions WHERE created_by=ANY($1::uuid[])",
    [users],
  );
  await app.close();
  for (const key of await redis.keys(`${namespace}:*`)) await redis.del(key);
  await redis.quit();
  await f.cleanup();
});
it("denies no-context and cross-owner delegation/item reads and writes using actual nonprivileged app role", async () => {
  expect((await f.app.query("SELECT * FROM confsys.order_items")).rows).toEqual(
    [],
  );
  expect(
    (await f.app.query("SELECT * FROM confsys.order_payers")).rows,
  ).toEqual([]);
  await expect(
    f.app.query(
      "INSERT INTO confsys.order_payers(order_id,payer_id,granted_by) VALUES($1,$2,$3)",
      [ownerOrder, other.id, owner.id],
    ),
  ).rejects.toMatchObject({ code: "42501" });
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [other.id]);
    expect(
      (
        await db.query("SELECT * FROM confsys.order_items WHERE order_id=$1", [
          ownerOrder,
        ])
      ).rows,
    ).toEqual([]);
  });
  await expect(
    withIdentityTransaction(f.app, async (db) => {
      await db.query("SELECT set_config('app.actor_id',$1,true)", [other.id]);
      await db.query(
        "INSERT INTO confsys.order_payers(order_id,payer_id,granted_by) VALUES($1,$2,$2)",
        [ownerOrder, other.id],
      );
    }),
  ).rejects.toMatchObject({ code: "42501" });
  await expect(
    withIdentityTransaction(f.app, async (db) => {
      await db.query("SELECT set_config('app.actor_id',$1,true)", [other.id]);
      await db.query(
        "INSERT INTO confsys.order_items(id,order_id,description,amount,price_snapshot) VALUES($1,$2,'forged',1,'{}')",
        [rid(), ownerOrder],
      );
    }),
  ).rejects.toMatchObject({ code: "42501" });
  await finance.payer(
    owner.raw,
    { orderId: ownerOrder, payerEmail: other.email, remove: false },
    rid(),
  );
  expect(
    (await finance.dashboard(other.raw, "own", 0)).orders.some(
      (o) => o.id === ownerOrder,
    ),
  ).toBe(true);
  expect(
    (await f.app.query("SELECT * FROM confsys.order_payers")).rows,
  ).toEqual([]);
  expect(
    (
      await f.app.query("DELETE FROM confsys.order_payers WHERE order_id=$1", [
        ownerOrder,
      ])
    ).rowCount,
  ).toBe(0);
  await withIdentityTransaction(f.app, async (db) => {
    await db.query("SELECT set_config('app.actor_id',$1,true)", [other.id]);
    expect(
      (
        await db.query("DELETE FROM confsys.order_payers WHERE order_id=$1", [
          ownerOrder,
        ])
      ).rowCount,
    ).toBe(0);
  });
});
it("owner can revoke a disabled group payer through HTTP, preventing access after reactivation", async () => {
  await f.admin.query("UPDATE confsys.users SET state='disabled' WHERE id=$1", [
    other.id,
  ]);
  const response = await post(owner.raw, "/api/finance/payer", {
    orderId: ownerOrder,
    payerEmail: other.email,
    remove: true,
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().changed).toBe(true);
  await f.admin.query("UPDATE confsys.users SET state='active' WHERE id=$1", [
    other.id,
  ]);
  expect(
    (await finance.dashboard(other.raw, "own", 0)).orders.some(
      (o) => o.id === ownerOrder,
    ),
  ).toBe(false);
});
it("database composite keys reject own booking rows pointing at another registration or order", async () => {
  for (const [registration, order] of [
    [otherRegistration, ownerOrder],
    [registrationId, otherOrder],
  ]) {
    await expect(
      withIdentityTransaction(f.app, async (db) => {
        await db.query("SELECT set_config('app.actor_id',$1,true)", [owner.id]);
        await db.query(
          "INSERT INTO confsys.activity_bookings(id,registration_id,user_id,activity_id,activity_version,quantity,meal_type,state,order_id,snapshot,idempotency_key,request_hash) VALUES($1,$2,$3,$4,1,1,'vegetarian','reserved',$5,'{}',$6,'synthetic')",
          [rid(), registration, owner.id, activityId, order, rid()],
        );
      }),
    ).rejects.toMatchObject({ code: "23503" });
  }
});
it("paginates more than100 allocations independently from order pages, filters scope and refunds an older allocation through HTTP", async () => {
  const payment = await finance.submit(
    owner.raw,
    {
      idempotencyKey: rid(),
      amount: "101",
      currency: "TWD",
      reference: `synthetic-pagination-${rid()}`,
      evidenceFileId: null,
    },
    rid(),
  );
  await finance.verify(
    admin.raw,
    { id: payment.id, action: "verify", reason: "Synthetic verified transfer" },
    rid(),
  );
  for (let i = 0; i < 101; i++)
    await finance.allocate(
      admin.raw,
      {
        idempotencyKey: rid(),
        paymentId: payment.id,
        orderId: ownerOrder,
        amount: "1",
        reason: "Synthetic partial allocation history",
      },
      rid(),
    );
  const first = await finance.dashboard(owner.raw, "own", 1000, 0, ownerOrder);
  expect(first.orders).toHaveLength(0);
  expect(first.payments).toHaveLength(0);
  expect(first.allocations).toHaveLength(100);
  expect(first.allocationsNextOffset).toBe(100);
  const second = await finance.dashboard(
    owner.raw,
    "own",
    1000,
    100,
    ownerOrder,
  );
  expect(second.allocations).toHaveLength(1);
  expect(second.allocationsNextOffset).toBeNull();
  expect(
    new Set([...first.allocations, ...second.allocations].map((a) => a.id))
      .size,
  ).toBe(101);
  expect(
    (await finance.dashboard(other.raw, "own", 0, 0, ownerOrder)).allocations,
  ).toEqual([]);
  expect(
    (await finance.dashboard(admin.raw, "own", 0, 0, ownerOrder)).allocations,
  ).toEqual([]);
  expect(
    (await finance.dashboard(admin.raw, "admin", 0, 0, otherOrder)).allocations,
  ).toEqual([]);
  const response = await app.inject({
    url: `/api/finance/dashboard?scope=own&allocationOffset=100&allocationOrderId=${ownerOrder}`,
    headers: { cookie: `${cookiePolicy(f.config).name}=${owner.raw}` },
  });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().allocations).toHaveLength(1);
  expect(response.json().allocationsNextOffset).toBeNull();
  const invalid = await app.inject({
    url: "/api/finance/dashboard?allocationOffset=-1",
    headers: { cookie: `${cookiePolicy(f.config).name}=${owner.raw}` },
  });
  expect(invalid.statusCode).toBe(400);
  const refund = await post(admin.raw, "/api/finance/refund", {
    idempotencyKey: rid(),
    allocationId: second.allocations[0]!.id,
    amount: "1",
    reference: `synthetic-old-refund-${rid()}`,
    reason: "Refund old allocation reached through independent pager",
  });
  expect(refund.statusCode, refund.body).toBe(200);
  expect(
    (await finance.dashboard(owner.raw, "own", 0, 100, ownerOrder))
      .allocations[0]?.refunded,
  ).toBe("1");
});
it("payment RLS denies participant reconciliation and forged verified inserts while finance transitions stay terminal", async () => {
  const payment = await finance.submit(
    owner.raw,
    {
      idempotencyKey: rid(),
      amount: "1",
      currency: "TWD",
      reference: rid(),
      evidenceFileId: null,
    },
    rid(),
  );
  for (const actor of [null, owner.id, other.id])
    await withIdentityTransaction(f.app, async (db) => {
      await db.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.finance_admin','false',true)",
        [actor ?? ""],
      );
      expect(
        (
          await db.query(
            "UPDATE confsys.payments SET state='verified',verified_by=$2 WHERE id=$1",
            [payment.id, owner.id],
          )
        ).rowCount,
      ).toBe(0);
    });
  for (const state of ["verified", "rejected"])
    await expect(
      withIdentityTransaction(f.app, async (db) => {
        await db.query(
          "SELECT set_config('app.actor_id',$1,true),set_config('app.finance_admin','false',true)",
          [owner.id],
        );
        await db.query(
          "INSERT INTO confsys.payments(id,payer_id,state,amount,currency,reference,idempotency_key,request_hash,verified_by) VALUES($1,$2,$3,1,'TWD',$4,$5,'forged',$2)",
          [rid(), owner.id, state, rid(), rid()],
        );
      }),
    ).rejects.toMatchObject({ code: "42501" });
  expect(
    (
      await post(owner.raw, "/api/finance/verify", {
        id: payment.id,
        action: "verify",
        reason: "Forbidden self reconciliation",
      })
    ).statusCode,
  ).toBe(403);
  expect(
    (
      await finance.verify(
        admin.raw,
        {
          id: payment.id,
          action: "verify",
          reason: "Authorized reconciliation",
        },
        rid(),
      )
    ).state,
  ).toBe("verified");
  await expect(
    withIdentityTransaction(f.app, async (db) => {
      await db.query(
        "SELECT set_config('app.actor_id',$1,true),set_config('app.finance_admin','true',true)",
        [admin.id],
      );
      await db.query(
        "UPDATE confsys.payments SET state='submitted',verified_by=NULL WHERE id=$1",
        [payment.id],
      );
    }),
  ).rejects.toMatchObject({
    code: "23514",
    constraint: "payment_verification_transition",
  });
});
it("replacement money settles a refunded open order without recycling original money and concurrent excess rolls back", async () => {
  async function paid(amount: string) {
    const p = await finance.submit(
      other.raw,
      {
        idempotencyKey: rid(),
        amount,
        currency: "TWD",
        reference: rid(),
        evidenceFileId: null,
      },
      rid(),
    );
    await finance.verify(
      admin.raw,
      { id: p.id, action: "verify", reason: "Synthetic settlement transfer" },
      rid(),
    );
    return p;
  }
  const original = await paid("200"),
    allocate = (paymentId: string, amount: string) =>
      finance.allocate(
        admin.raw,
        {
          idempotencyKey: rid(),
          paymentId,
          orderId: otherOrder,
          amount,
          reason: "Synthetic settlement allocation",
        },
        rid(),
      );
  const allocation = await allocate(original.id, "200");
  await finance.refund(
    admin.raw,
    {
      idempotencyKey: rid(),
      allocationId: allocation.id,
      amount: "40",
      reference: rid(),
      reason: "Synthetic partial refund",
    },
    rid(),
  );
  await expect(allocate(original.id, "1")).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const replacement = await paid("80");
  const attempts = await Promise.allSettled([
    allocate(replacement.id, "40"),
    allocate(replacement.id, "40"),
  ]);
  expect(attempts.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(attempts.filter((x) => x.status === "rejected")).toHaveLength(1);
  const order = (await reg.mine(other.raw, 0)).items[0]!.order!;
  expect(order.paid).toBe("240");
  expect(order.refunded).toBe("40");
  const rows = (
    await f.admin.query(
      "SELECT id FROM confsys.payment_allocations WHERE payment_id=$1",
      [replacement.id],
    )
  ).rows;
  expect(rows).toHaveLength(1);
  expect(
    (
      await f.admin.query(
        "SELECT id FROM confsys.auth_audit WHERE event='payment.allocated' AND after_value=$1",
        [rows[0].id],
      )
    ).rowCount,
  ).toBe(1);
});
it("duplicate booking and redeemed cancellation return HTTP409 and leave orders and history intact", async () => {
  const input = {
    activityId,
    version: 1,
    registrationId: otherRegistration,
    quantity: 1,
    mealType: "vegetarian",
    idempotencyKey: rid(),
  };
  const booking = await activities.book(other.raw, input, rid());
  const count = async () =>
    Number(
      (
        await f.admin.query(
          "SELECT count(*) FROM confsys.orders WHERE user_id=$1",
          [other.id],
        )
      ).rows[0].count,
    );
  const before = await count();
  const duplicate = await post(other.raw, "/api/activities/book", {
    ...input,
    idempotencyKey: rid(),
  });
  expect(duplicate.statusCode, duplicate.body).toBe(409);
  expect(duplicate.json().error.code).toBe("CONFLICT");
  expect(await count()).toBe(before);
  const payment = await finance.submit(
    other.raw,
    {
      idempotencyKey: rid(),
      amount: "10",
      currency: "TWD",
      reference: rid(),
      evidenceFileId: null,
    },
    rid(),
  );
  await finance.verify(
    admin.raw,
    { id: payment.id, action: "verify", reason: "Meal paid" },
    rid(),
  );
  await finance.allocate(
    admin.raw,
    {
      idempotencyKey: rid(),
      paymentId: payment.id,
      orderId: booking.orderId,
      amount: "10",
      reason: "Meal settled",
    },
    rid(),
  );
  const onsite = createOnsiteService(f.app, f.config),
    pass = await onsite.pass(
      other.raw,
      { registrationId: otherRegistration },
      rid(),
    );
  await onsite.redeem(
    admin.raw,
    {
      token: pass.token,
      bookingId: booking.id,
      quantity: 1,
      idempotencyKey: rid(),
    },
    rid(),
  );
  for (const raw of [other.raw, admin.raw])
    for (const [url, id] of [
      ["/api/activities/cancel", booking.id],
      ["/api/registration/cancel", otherRegistration],
    ]) {
      const response = await post(raw, url!, {
        id,
        reason: "Redeemed cancellation rejected",
      });
      expect(response.statusCode, response.body).toBe(409);
      expect(response.json().error.code).toBe("CONFLICT");
    }
  expect((await activities.mine(other.raw, 0)).items[0]?.state).toBe(
    "reserved",
  );
  expect((await reg.mine(other.raw, 0)).items[0]?.state).toBe("confirmed");
  expect((await reg.history(other.raw, otherRegistration)).items).toEqual([]);
  expect(await count()).toBe(before);
});
it("activity and registration HTTP cancellation share deadline policy; admin cascade is audited and atomic", async () => {
  const booking = await activities.book(
    owner.raw,
    {
      activityId,
      version: 1,
      registrationId,
      quantity: 1,
      mealType: "vegetarian",
      idempotencyKey: rid(),
    },
    rid(),
  );
  const activity = (await activities.catalog()).items.find(
    (a) => a.id === activityId,
  )!;
  await activities.save(
    admin.raw,
    {
      id: activityId,
      expectedVersion: 1,
      document: {
        ...activity.document,
        deadline: new Date(Date.now() - 1000).toISOString(),
      },
      reason: "Synthetic deadline elapsed",
    },
    rid(),
  );
  for (const [url, id] of [
    ["/api/activities/cancel", booking.id],
    ["/api/registration/cancel", registrationId],
  ]) {
    const response = await post(owner.raw, url!, {
      id,
      reason: "Owner cancellation after deadline",
    });
    expect(response.statusCode, response.body).toBe(409);
    expect(response.json().error.code).toBe("CONFLICT");
  }
  expect((await activities.mine(owner.raw, 0)).items[0]?.state).toBe(
    "reserved",
  );
  expect((await reg.mine(owner.raw, 0)).items[0]?.state).toBe("confirmed");
  const response = await post(admin.raw, "/api/registration/cancel", {
    id: registrationId,
    reason: "Administrative late cancellation authorized",
  });
  expect(response.statusCode, response.body).toBe(200);
  expect((await activities.mine(owner.raw, 0)).items[0]?.state).toBe(
    "cancelled",
  );
  expect(
    (
      await f.admin.query(
        "SELECT state FROM confsys.orders WHERE registration_id=$1",
        [registrationId],
      )
    ).rows.every((r) => r.state === "cancelled"),
  ).toBe(true);
  expect((await reg.history(owner.raw, registrationId)).items[0]?.reason).toBe(
    "Administrative late cancellation authorized",
  );
});

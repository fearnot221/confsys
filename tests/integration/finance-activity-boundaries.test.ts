import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import { withIdentityTransaction } from "@confsys/db";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createRegistrationService } from "../../apps/api/src/registration/service.js";
import { createActivitiesService } from "../../apps/api/src/activities/service.js";
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
      "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
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
            rates: [{ startsAt: start, endsAt: end, amount: "100" }],
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

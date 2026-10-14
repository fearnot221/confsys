import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { authFixture, password } from "../helpers/auth.js";
import { completeSite } from "../helpers/site.js";
import {
  createAuthService,
  tokenHash,
} from "../../apps/api/src/auth/service.js";
import { createAccessService } from "../../apps/api/src/access/service.js";
import { createSiteService } from "../../apps/api/src/site/service.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { buildApp } from "../../apps/api/src/app.js";
import { registerAuthRoutes } from "../../apps/api/src/auth/routes.js";
import { registerSiteRoutes } from "../../apps/api/src/site/routes.js";
import { registerInstanceRoute } from "../../apps/api/src/instance.js";
import { registerPublicRoutes } from "../../apps/api/src/site/public-routes.js";
import { processNotification } from "@confsys/notifications/worker";
import { createRateLimiter } from "../../apps/api/src/auth/rate-limit.js";
import { Redis } from "ioredis";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  site = createSiteService(f.app, f.config),
  access = createAccessService(f.app, f.config),
  rid = () => randomUUID();
async function account() {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const l = await auth.login(email, password, rid());
  return { id: l.account.user.id, email, raw: l.raw };
}
let leader: Awaited<ReturnType<typeof account>>,
  ordinary: Awaited<ReturnType<typeof account>>,
  staff: Awaited<ReturnType<typeof account>>;
let baseline: Record<string, unknown>;
beforeAll(async () => {
  f.migrate();
  baseline = (await f.admin.query("SELECT * FROM confsys.site_state")).rows[0];
  leader = await account();
  await bootstrapAdministrator(
    f.admin,
    {
      conferenceName: f.config.CONFERENCE_NAME,
      origin: f.config.PUBLIC_APP_ORIGIN,
    },
    {
      targetId: leader.id,
      apply: true,
      reason: "synthetic site bootstrap",
      confirmOrigin: f.config.PUBLIC_APP_ORIGIN,
    },
    rid(),
  );
  leader.raw = (await auth.login(leader.email, password, rid())).raw;
  ordinary = await account();
  staff = await account();
  await access.mutate(
    leader.raw,
    staff.id,
    {
      action: "grant",
      role: "conference_staff",
      reason: "synthetic site staff",
    },
    rid(),
  );
  staff.raw = (await auth.login(staff.email, password, rid())).raw;
});
afterAll(async () => {
  await f.admin.query(
    "UPDATE confsys.site_state SET draft_version=$1,document=$2,active_publication_id=$3",
    [baseline.draft_version, baseline.document, baseline.active_publication_id],
  );
  await f.admin.query(
    "DELETE FROM confsys.site_publications WHERE published_by IN (SELECT id FROM confsys.users WHERE email LIKE $1)",
    [`${f.prefix}%`],
  );
  await f.cleanup();
});
it("unpublished fallback, first-create and same-version saves conflict without overwriting; staff and ordinary cannot preview/history/write", async () => {
  expect(await site.public()).toMatchObject({
    document: null,
    conferenceName: f.config.CONFERENCE_NAME,
  });
  for (const raw of [undefined, ordinary.raw, staff.raw])
    for (const read of [
      () => site.draft(raw),
      () => site.preview(raw, 1),
      () => site.history(raw, 0),
      () =>
        site.save(raw, { expectedVersion: 0, document: completeSite() }, rid()),
    ])
      await expect(read()).rejects.toMatchObject({
        code: raw ? "FORBIDDEN" : "SESSION_EXPIRED",
      });
  const results = await Promise.allSettled([
    site.save(
      leader.raw,
      { expectedVersion: 0, document: completeSite("Draft A") },
      rid(),
    ),
    site.save(
      leader.raw,
      { expectedVersion: 0, document: completeSite("Draft B") },
      rid(),
    ),
  ]);
  expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  expect(results.find((x) => x.status === "rejected")).toMatchObject({
    reason: { code: "CONFLICT" },
  });
  expect((await site.public()).document).toBeNull();
  expect((await site.preview(leader.raw, 1)).draftVersion).toBe(1);
  await expect(site.preview(leader.raw, 2)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const doc = completeSite();
  await site.save(leader.raw, { expectedVersion: 1, document: doc }, rid());
  await expect(
    site.save(leader.raw, { expectedVersion: 1, document: doc }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
it("publish validates current proof/version; simultaneous repeat publication produces one snapshot and audit; new drafts and restore never change official brand", async () => {
  await f.admin.query(
    "UPDATE confsys.sessions SET password_verified_at=null WHERE token_hash=$1",
    [tokenHash(leader.raw)],
  );
  await expect(
    site.publish(leader.raw, { expectedVersion: 2 }, rid()),
  ).rejects.toMatchObject({ code: "REAUTH_REQUIRED" });
  await auth.reauthenticate(leader.raw, password, rid());
  const results = await Promise.all([
    site.publish(leader.raw, { expectedVersion: 2 }, rid()),
    site.publish(leader.raw, { expectedVersion: 2 }, rid()),
  ]);
  expect(results[0]).toEqual(results[1]);
  expect(
    (
      await f.admin.query(
        "SELECT count(*) FROM confsys.auth_audit WHERE event='site.published' AND actor_id=$1",
        [leader.id],
      )
    ).rows[0].count,
  ).toBe("1");
  const first = await site.public();
  expect(first.publicationId).toBe(results[0]!.publicationId);
  await site.save(
    leader.raw,
    { expectedVersion: 2, document: completeSite("Private draft") },
    rid(),
  );
  expect(await site.public()).toEqual(first);
  await expect(
    site.publish(leader.raw, { expectedVersion: 2 }, rid()),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await site.publish(leader.raw, { expectedVersion: 3 }, rid());
  const second = await site.public();
  const restored = await site.restore(
    leader.raw,
    { expectedVersion: 3, publicationId: first.publicationId },
    rid(),
  );
  expect(restored.draftVersion).toBe(4);
  expect(await site.public()).toEqual(second);
  expect(restored.document).toEqual(first.document);
  await expect(
    site.restore(
      leader.raw,
      { expectedVersion: 3, publicationId: first.publicationId },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const h = await site.history(leader.raw, 0);
  expect(h.items).toHaveLength(2);
  expect(h.items[0]!.changedFields).toContain("translations");
});
it("required audit failure rolls back save, publish pointer/snapshot and restore; app/worker cannot rewrite history", async () => {
  const before = await site.draft(leader.raw),
    pub = await site.public(),
    history = await site.history(leader.raw, 0),
    failure = rid();
  await f.admin.query(
    `CREATE FUNCTION confsys.site_test_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.request_id='${failure}'::uuid THEN RAISE EXCEPTION 'synthetic'; END IF; RETURN NEW; END $$`,
  );
  await f.admin.query(
    "CREATE TRIGGER site_test_failure BEFORE INSERT ON confsys.auth_audit FOR EACH ROW EXECUTE FUNCTION confsys.site_test_failure()",
  );
  try {
    for (const op of [
      () =>
        site.save(
          leader.raw,
          { expectedVersion: 4, document: completeSite("Failure") },
          failure,
        ),
      () => site.publish(leader.raw, { expectedVersion: 4 }, failure),
      () =>
        site.restore(
          leader.raw,
          { expectedVersion: 4, publicationId: pub.publicationId },
          failure,
        ),
    ]) {
      await expect(op()).rejects.toThrow();
      expect(await site.draft(leader.raw)).toEqual(before);
      expect(await site.public()).toEqual(pub);
      expect(await site.history(leader.raw, 0)).toEqual(history);
    }
  } finally {
    await f.admin.query("DROP TRIGGER site_test_failure ON confsys.auth_audit");
    await f.admin.query("DROP FUNCTION confsys.site_test_failure()");
  }
  for (const db of [f.app, f.worker])
    for (const sql of [
      "UPDATE confsys.site_publications SET document=document WHERE false",
      "DELETE FROM confsys.site_publications WHERE false",
    ])
      await expect(db.query(sql)).rejects.toMatchObject({ code: "42501" });
  await expect(
    f.worker.query("SELECT * FROM confsys.site_state"),
  ).rejects.toMatchObject({ code: "42501" });
});
it("mail captures only effective published branding; retry preserves snapshot and legacy pending jobs keep bootstrap fallback", async () => {
  const address = f.email();
  await auth.requestMail("register", address, rid());
  const n = await f.link(address);
  const before = (
    await f.admin.query(
      "SELECT conference_name FROM confsys.notifications WHERE id=$1",
      [n.id],
    )
  ).rows[0].conference_name;
  expect(before).toBe("Private draft");
  await site.publish(leader.raw, { expectedVersion: 4 }, rid());
  let captured = "";
  await processNotification(f.worker, f.workerConfig, n.id, async (mail) => {
    captured = mail.subject;
    throw Object.assign(new Error("synthetic"), {
      code: "ESOCKET",
      originalCode: "ECONNREFUSED",
      command: "CONN",
    });
  });
  expect(captured).toContain(before);
  await f.admin.query(
    "UPDATE confsys.notifications SET next_attempt_at=now() WHERE id=$1",
    [n.id],
  );
  await processNotification(f.worker, f.workerConfig, n.id, async (mail) => {
    expect(mail.subject).toContain(before);
    expect(mail.text).toContain(f.config.PUBLIC_APP_ORIGIN);
    return { messageId: rid() };
  });
  const legacy = f.email();
  await auth.requestMail("register", legacy, rid());
  const old = await f.link(legacy);
  await f.admin.query(
    "UPDATE confsys.notifications SET conference_name=null WHERE id=$1",
    [old.id],
  );
  await processNotification(f.worker, f.workerConfig, old.id, async (mail) => {
    expect(mail.subject).toContain(f.config.CONFERENCE_NAME);
    return { messageId: rid() };
  });
});
it("queued publisher rechecks permission, disabled state and revoked session after the access lock", async () => {
  for (const action of ["revoke", "disable", "revoke_sessions"]) {
    const target = await account();
    await access.mutate(
      leader.raw,
      target.id,
      { action: "grant", role: "conference_admin", reason: "synthetic race" },
      rid(),
    );
    target.raw = (await auth.login(target.email, password, rid())).raw;
    const blocker = await f.admin.connect();
    await blocker.query("BEGIN");
    await blocker.query("SELECT * FROM confsys.access_control FOR UPDATE");
    const revocation = access.mutate(
      leader.raw,
      target.id,
      {
        action,
        reason: "synthetic race",
        ...(action === "revoke" ? { role: "conference_admin" } : {}),
      },
      rid(),
    );
    // Observe an actual PostgreSQL lock waiter before enqueueing publication; no sleep-based race assumption.
    await expect
      .poll(async () =>
        Number(
          (
            await f.app.query(
              "SELECT count(*) FROM pg_stat_activity WHERE usename='confsys_app' AND wait_event_type='Lock'",
            )
          ).rows[0].count,
        ),
      )
      .toBeGreaterThan(0);
    const publishing = site.publish(target.raw, { expectedVersion: 4 }, rid());
    const rejected = expect(publishing).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
    await blocker.query("COMMIT");
    blocker.release();
    await revocation;
    await rejected;
    await expect(site.preview(target.raw, 4)).rejects.toMatchObject({
      code: "SESSION_EXPIRED",
    });
  }
});
it("HTTP/SSR strict fields, CSRF, payload, private projections, no-store, canonical, locale, XSS and unavailable DB", async () => {
  const up = async () => {};
  const server = buildApp({ postgres: up, redis: up, worker: up });
  const redis = new Redis(f.config.REDIS_URL);
  registerInstanceRoute(server, f.config, site.public);
  await registerAuthRoutes(server, {
    config: f.config,
    service: auth,
    limit: createRateLimiter(redis, f.config.CSRF_SIGNING_KEY, `site-${rid()}`),
  });
  registerSiteRoutes(server, f.config, site);
  // Source renderer exercised here; production artifact separately tested by E2E and containers.
  const { renderSite } = await import("../../apps/web/src/entry-server.js");
  await registerPublicRoutes(server, f.config, site, renderSite);
  const host = new URL(f.config.PUBLIC_APP_ORIGIN).host,
    headers = { host, cookie: `dev-session=${leader.raw}` };
  try {
    const csrf = await server.inject({
      url: "/api/auth/csrf",
      headers: { host },
    });
    const cookie = csrf.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const post = (payload: object, extra: Record<string, string> = {}) =>
      server.inject({
        method: "POST",
        url: "/api/site/draft",
        payload,
        headers: {
          ...headers,
          cookie: `${headers.cookie}; ${cookie}`,
          origin: f.config.PUBLIC_APP_ORIGIN,
          "x-csrf-token": csrf.json().csrfToken,
          ...extra,
        },
      });
    for (const extra of [
      { origin: "http://evil.invalid" },
      { "x-csrf-token": "" },
    ])
      expect(
        (await post({ expectedVersion: 4, document: completeSite() }, extra))
          .statusCode,
      ).toBe(403);
    for (const key of [
      "publishedAt",
      "activePublicationId",
      "SMTP_FROM",
      "permissions",
    ])
      expect(
        (
          await post({
            expectedVersion: 4,
            document: completeSite(),
            [key]: "bad",
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (
        await post({
          expectedVersion: 4,
          document: completeSite(),
          oversized: "x".repeat(140000),
        })
      ).statusCode,
    ).toBe(413);
    const d = completeSite('Title " ><script>alert(1)</script>');
    d.translations["zh-Hant"].pages.home.body =
      "</script><img src=x onerror=alert(1)>";
    d.translations["zh-Hant"].pages.home.links = [
      { label: "Research", url: "https://example.invalid/?a=1&b=2" },
    ];
    expect((await post({ expectedVersion: 4, document: d })).statusCode).toBe(
      200,
    );
    await site.publish(leader.raw, { expectedVersion: 5 }, rid());
    const html = await server.inject({
      url: "/zh-Hant/home",
      headers: { host },
    });
    expect(html.statusCode).toBe(200);
    expect(html.headers["cache-control"]).toBe("no-store");
    expect(html.body).toContain("&lt;script&gt;");
    expect(html.body).not.toContain("<script>");
    expect(html.body).toContain('lang="zh-Hant"');
    expect(html.body).toContain(`${f.config.PUBLIC_APP_ORIGIN}/zh-Hant/home`);
    expect(html.body).toContain("2027-02-28");
    const dto = await server.inject({ url: "/api/site?draft=true", headers });
    expect(Object.keys(dto.json()).sort()).toEqual([
      "conferenceName",
      "document",
      "publicationId",
    ]);
    expect(dto.body).not.toMatch(/publishedBy|draftVersion|credential_version/);
    const privateResponse = await server.inject({
      url: "/api/site/preview?version=5",
      headers,
    });
    expect(privateResponse.headers["x-robots-tag"]).toContain("noindex");
    expect(privateResponse.headers["cache-control"]).toBe("no-store");
    for (const url of ["/fr/home", "/en/missing", "/not-a-page"])
      expect((await server.inject({ url, headers: { host } })).statusCode).toBe(
        404,
      );
    expect(
      (
        await server.inject({
          url: "/en/home",
          headers: { host: "evil.invalid" },
        })
      ).statusCode,
    ).toBe(403);
    const sitemap = await server.inject({
      url: "/sitemap.xml",
      headers: { host },
    });
    expect(sitemap.body).toContain(`${f.config.PUBLIC_APP_ORIGIN}/en/contact`);
    expect(sitemap.body).not.toContain("/admin/");
    const missing = { ...d, contactEmail: "" };
    await site.save(
      leader.raw,
      { expectedVersion: 5, document: missing },
      rid(),
    );
    await expect(
      site.publish(leader.raw, { expectedVersion: 6 }, rid()),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect((await site.public()).publicationId).toBe(dto.json().publicationId);
    await f.admin.query(
      "REVOKE SELECT ON confsys.site_publications FROM confsys_app",
    );
    try {
      expect(
        (await server.inject({ url: "/api/site", headers: { host } }))
          .statusCode,
      ).toBeGreaterThanOrEqual(500);
    } finally {
      await f.admin.query(
        "GRANT SELECT ON confsys.site_publications TO confsys_app",
      );
    }
  } finally {
    redis.disconnect();
    await server.close();
  }
});

it("public readers racing publication see one complete immutable version and a later read sees the committed pointer", async () => {
  const current = await site.draft(leader.raw);
  const saved = await site.save(
    leader.raw,
    {
      expectedVersion: current.draftVersion,
      document: completeSite("Atomic old"),
    },
    rid(),
  );
  await site.publish(
    leader.raw,
    { expectedVersion: saved.draftVersion },
    rid(),
  );
  const old = await site.public();
  const next = await site.save(
    leader.raw,
    {
      expectedVersion: saved.draftVersion,
      document: completeSite("Atomic new"),
    },
    rid(),
  );
  const reads = Array.from({ length: 15 }, () => site.public());
  await site.publish(leader.raw, { expectedVersion: next.draftVersion }, rid());
  const published = await site.public();
  expect(published.conferenceName).toBe("Atomic new");
  for (const result of await Promise.all(reads))
    expect(result).toEqual(
      result.publicationId === old.publicationId ? old : published,
    );
  const outcomes = await Promise.allSettled([
    site.save(
      leader.raw,
      {
        expectedVersion: next.draftVersion,
        document: completeSite("Unpublished race"),
      },
      rid(),
    ),
    site.publish(leader.raw, { expectedVersion: next.draftVersion }, rid()),
  ]);
  expect(outcomes[0]!.status).toBe("fulfilled");
  expect(await site.public()).toEqual(published);
  const invalid = completeSite();
  invalid.translations.en.pages.home.links = [
    { label: "bad", url: "javascript:alert(1)" },
  ];
  await expect(
    site.save(
      leader.raw,
      { expectedVersion: next.draftVersion + 1, document: invalid },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
});

it("disabled translations stay private; enabled missing optional text falls back with actual language markers", async () => {
  const d = completeSite("Locale publication");
  d.enabledLocales = ["zh-Hant"];
  d.translations.en.pages.home.body = "Private unfinished translation";
  const v = (await site.draft(leader.raw)).draftVersion;
  await site.save(leader.raw, { expectedVersion: v, document: d }, rid());
  await site.publish(leader.raw, { expectedVersion: v + 1 }, rid());
  expect(JSON.stringify(await site.public())).not.toContain(
    "Private unfinished translation",
  );
  expect(
    (await site.draft(leader.raw)).document.translations.en.pages.home.body,
  ).toBe("Private unfinished translation");
  d.enabledLocales = ["zh-Hant", "en"];
  d.translations.en.pages.home.body = "";
  await site.save(leader.raw, { expectedVersion: v + 1, document: d }, rid());
  await site.publish(leader.raw, { expectedVersion: v + 2 }, rid());
  const { renderSite } = await import("../../apps/web/src/entry-server.js");
  expect(
    await createSiteService(f.app, {
      ...f.config,
      CONFERENCE_NAME: "Changed bootstrap env",
    }).public(),
  ).toEqual(await site.public());
  const html = renderSite(
    await site.public(),
    "en",
    "home",
    f.config.PUBLIC_APP_ORIGIN,
  );
  expect(html).toContain('lang="zh-Hant">公開導言');
  expect(html).toContain('hrefLang="zh-Hant"');
});
it("optional pages publish atomically, disappear only after next publication, and follow default-language fallback", async () => {
 const current=await site.draft(leader.raw);
 const doc=structuredClone(current.document);
 doc.translations['zh-Hant'].pages.news={title:'大會公告',description:'合成公告測試',body:'<script>alert(1)</script>',bullets:[],links:[{label:'報名入口',url:'/registration'}]};
 await site.save(leader.raw,{expectedVersion:current.draftVersion,document:doc},rid());
 const up=async()=>{};
 const server=buildApp({postgres:up,redis:up,worker:up});
 const {renderSite}=await import('../../apps/web/src/entry-server.js');
 await registerPublicRoutes(server,f.config,site,renderSite);
 const headers={host:new URL(f.config.PUBLIC_APP_ORIGIN).host};
 try {
  expect((await server.inject({url:'/zh-Hant/news',headers})).statusCode).toBe(404);
  await site.publish(leader.raw,{expectedVersion:current.draftVersion+1},rid());
  const result=await server.inject({url:'/en/news',headers});
  expect(result.statusCode).toBe(200);
  expect(result.body).toContain('&lt;script&gt;');
  expect(result.body).toContain('property="og:title" content="大會公告"');
  expect(result.body).toContain(`property="og:url" content="${f.config.PUBLIC_APP_ORIGIN}/en/news"`);
  expect(result.body).toContain('property="og:locale" content="en_US"');
  expect(result.body).not.toContain('<script>alert');
  expect((await server.inject({url:'/sitemap.xml',headers})).body).toContain('/en/news');
  delete doc.translations['zh-Hant'].pages.news;
  await site.save(leader.raw,{expectedVersion:current.draftVersion+1,document:doc},rid());
  expect((await server.inject({url:'/zh-Hant/news',headers})).statusCode).toBe(200);
  await site.publish(leader.raw,{expectedVersion:current.draftVersion+2},rid());
  expect((await server.inject({url:'/zh-Hant/news',headers})).statusCode).toBe(404);
 } finally {await server.close();}
});

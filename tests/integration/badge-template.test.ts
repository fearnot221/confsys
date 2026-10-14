import { beforeAll, afterAll, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { createAccessService } from "../../apps/api/src/access/service.js";
import { createBadgeTemplateService } from "../../apps/api/src/badge-template/service.js";
import { createDocumentJobsService } from "../../apps/api/src/document-jobs/service.js";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  service = createBadgeTemplateService(f.app, f.config),
  access = createAccessService(f.app, f.config),
  jobs = createDocumentJobsService(f.app, f.config),
  rid = () => randomUUID();
async function account() {
  const email = f.email();
  await auth.requestMail("register", email, rid());
  await auth.consume("verify", (await f.link(email)).token, password, rid());
  const login = await auth.login(email, password, rid());
  return { id: login.account.user.id, email, raw: login.raw };
}
let admin: Awaited<ReturnType<typeof account>>,
  staff: Awaited<ReturnType<typeof account>>,
  owner: Awaited<ReturnType<typeof account>>,
  previousVersion: number | null,
  configVersion: number;
const registrationId = rid(),
  document = {
    size: "large" as const,
    layout: "centered" as const,
    showAffiliation: true,
    showRegistrationNumber: true,
    footer: "合成研討會",
  };
beforeAll(async () => {
  f.migrate();
  previousVersion = (
    await f.admin.query(
      "SELECT current_version FROM confsys.badge_template_state",
    )
  ).rows[0].current_version;
  admin = await account();
  staff = await account();
  owner = await account();
  await bootstrapAdministrator(
    f.admin,
    {
      conferenceName: f.config.CONFERENCE_NAME,
      origin: f.config.PUBLIC_APP_ORIGIN,
    },
    {
      targetId: admin.id,
      apply: true,
      reason: "Synthetic template test",
      confirmOrigin: f.config.PUBLIC_APP_ORIGIN,
    },
    rid(),
  );
  admin.raw = (await auth.login(admin.email, password, rid())).raw;
  await access.mutate(
    admin.raw,
    staff.id,
    { action: "grant", role: "onsite", reason: "Synthetic template staff" },
    rid(),
  );
  staff.raw = (await auth.login(staff.email, password, rid())).raw;
  configVersion = Number(
    (
      await f.admin.query(
        "SELECT coalesce(max(version),0)+1 AS version FROM confsys.registration_config_versions",
      )
    ).rows[0].version,
  );
  await f.admin.query(
    "INSERT INTO confsys.registration_config_versions(version,document,created_by) VALUES($1,'{}',$2)",
    [configVersion, admin.id],
  );
  await f.admin.query(
    "INSERT INTO confsys.registrations(id,user_id,config_version,ticket_id,ticket_name,state,badge_name,affiliation,answers,consent_snapshot,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'合成免費報名','confirmed','陳怡君','合成研究所','{}','synthetic',$5,'synthetic')",
    [registrationId, owner.id, configVersion, rid(), rid()],
  );
  await f.admin.query(
    "INSERT INTO confsys.orders(id,registration_id,user_id,state,amount,currency,kind) VALUES($1,$2,$3,'open',0,'TWD','registration')",
    [rid(), registrationId, owner.id],
  );
});
afterAll(async () => {
  await f.admin.query(
    "UPDATE confsys.badge_template_state SET current_version=$1",
    [previousVersion ?? null],
  );
  if (admin) {
    await f.admin.query(
      "DELETE FROM confsys.document_jobs WHERE requester_id=$1",
      [admin.id],
    );
    await f.admin.query(
      "DELETE FROM confsys.badge_template_versions WHERE created_by=$1",
      [admin.id],
    );
  }
  await f.admin.query(
    "DELETE FROM confsys.onsite_tokens WHERE registration_id=$1",
    [registrationId],
  );
  await f.admin.query("DELETE FROM confsys.orders WHERE registration_id=$1", [
    registrationId,
  ]);
  await f.admin.query("DELETE FROM confsys.registrations WHERE id=$1", [
    registrationId,
  ]);
  if (configVersion)
    await f.admin.query(
      "DELETE FROM confsys.registration_config_versions WHERE version=$1",
      [configVersion],
    );
  await f.cleanup();
});
it("staff reads synthetic preview; only admin saves with optimistic version, immutable history and job snapshot pin", async () => {
  await expect(service.get(owner.raw)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await expect(service.get(undefined)).rejects.toMatchObject({
    code: "SESSION_EXPIRED",
  });
  const before = await service.get(staff.raw);
  await expect(
    service.save(
      staff.raw,
      { expectedVersion: before.version, document },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const saved = await service.save(
    admin.raw,
    { expectedVersion: before.version, document },
    rid(),
  );
  expect(saved.version).toBe(before.version + 1);
  await expect(
    service.save(
      admin.raw,
      { expectedVersion: before.version, document },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  const key = rid(),
    job = await jobs.create(
      admin.raw,
      { registrationIds: [registrationId], idempotencyKey: key },
      rid(),
    );
  await service.save(
    admin.raw,
    {
      expectedVersion: saved.version,
      document: { ...document, size: "credit_card", footer: "預覽" },
    },
    rid(),
  );
  expect(
    (
      await f.admin.query(
        "SELECT snapshot->'template' AS template FROM confsys.document_jobs WHERE id=$1",
        [job.id],
      )
    ).rows[0].template,
  ).toEqual(saved);
  expect(
    (
      await jobs.create(
        admin.raw,
        { registrationIds: [registrationId], idempotencyKey: key },
        rid(),
      )
    ).id,
  ).toBe(job.id);
  expect((await service.preview(staff.raw)).subarray(0, 5).toString()).toBe(
    "%PDF-",
  );
  expect(
    (await f.app.query("SELECT version FROM confsys.badge_template_versions"))
      .rows,
  ).toEqual([]);
  await expect(
    f.app.query(
      "UPDATE confsys.badge_template_versions SET document='{}' WHERE version=$1",
      [saved.version],
    ),
  ).rejects.toMatchObject({ code: "42501" });
  const current = await service.get(admin.raw);
  await expect(
    service.save(
      admin.raw,
      {
        expectedVersion: current.version,
        document: { ...document, footer: "長".repeat(120) },
      },
      rid(),
    ),
  ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  expect((await service.get(admin.raw)).version).toBe(current.version);
});

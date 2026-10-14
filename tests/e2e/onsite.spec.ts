import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { authFixture } from "../helpers/auth.js";
import { register, login } from "../helpers/browser-account.js";
const f = authFixture(),
  registrationId = randomUUID(),
  orderId = randomUUID(),
  addonOrder = randomUUID(),
  activityId = randomUUID(),
  bookingId = randomUUID();
let version: number | undefined;
let ownerId: string | undefined;
let staffId: string | undefined;
test.afterAll(async () => {
  if (staffId)
    await f.admin.query(
      "DELETE FROM confsys.document_jobs WHERE requester_id=$1",
      [staffId],
    );
  await f.admin.query(
    "DELETE FROM confsys.onsite_redemption_reversals WHERE redemption_id IN(SELECT id FROM confsys.onsite_redemptions WHERE booking_id=$1)",
    [bookingId],
  );
  await f.admin.query(
    "DELETE FROM confsys.onsite_redemptions WHERE booking_id=$1",
    [bookingId],
  );
  await f.admin.query(
    "DELETE FROM confsys.onsite_checkin_reversals WHERE checkin_id IN(SELECT id FROM confsys.onsite_checkins WHERE registration_id=$1)",
    [registrationId],
  );
  await f.admin.query(
    "DELETE FROM confsys.onsite_checkins WHERE registration_id=$1",
    [registrationId],
  );
  await f.admin.query(
    "DELETE FROM confsys.onsite_tokens WHERE registration_id=$1",
    [registrationId],
  );
  await f.admin.query("DELETE FROM confsys.activity_bookings WHERE id=$1", [
    bookingId,
  ]);
  await f.admin.query("DELETE FROM confsys.activities WHERE id=$1", [
    activityId,
  ]);
  await f.admin.query("DELETE FROM confsys.activity_versions WHERE id=$1", [
    activityId,
  ]);
  await f.admin.query("DELETE FROM confsys.orders WHERE registration_id=$1", [
    registrationId,
  ]);
  await f.admin.query("DELETE FROM confsys.registrations WHERE id=$1", [
    registrationId,
  ]);
  if (version)
    await f.admin.query(
      "DELETE FROM confsys.registration_config_versions WHERE version=$1",
      [version],
    );
  await f.cleanup();
});
test("participant QR -> staff checkin and meal redemption -> selected batch worker PDF", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const ownerEmail = f.email(),
    staffEmail = f.email();
  await register(page, ownerEmail);
  await login(page, ownerEmail);
  ownerId = (await (await page.request.get("/api/auth/me")).json()).user.id;
  const staffContext = await browser.newContext(),
    staff = await staffContext.newPage();
  try {
    await register(staff, staffEmail);
    await login(staff, staffEmail);
    staffId = (await (await staff.request.get("/api/auth/me")).json()).user.id;
    await bootstrapAdministrator(
      f.admin,
      {
        conferenceName: f.config.CONFERENCE_NAME,
        origin: f.config.PUBLIC_APP_ORIGIN,
      },
      {
        targetId: staffId!,
        apply: true,
        reason: "Synthetic onsite browser bootstrap",
        confirmOrigin: f.config.PUBLIC_APP_ORIGIN,
      },
      randomUUID(),
    );
    await login(staff, staffEmail);
    version = Number(
      (
        await f.admin.query(
          "SELECT coalesce(max(version),0)+1 AS version FROM confsys.registration_config_versions",
        )
      ).rows[0].version,
    );
    await f.admin.query(
      "INSERT INTO confsys.registration_config_versions(version,document,created_by) VALUES($1,'{}',$2)",
      [version, staffId],
    );
    await f.admin.query(
      "INSERT INTO confsys.registrations(id,user_id,config_version,ticket_id,ticket_name,state,badge_name,affiliation,answers,consent_snapshot,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'免費合成票','confirmed','陳怡君','合成研究所','{}','synthetic',$5,'synthetic')",
      [registrationId, ownerId, version, randomUUID(), randomUUID()],
    );
    await f.admin.query(
      "INSERT INTO confsys.orders(id,registration_id,user_id,state,amount,currency,kind) VALUES($1,$2,$3,'open',0,'TWD','registration'),($4,$2,$3,'open',0,'TWD','activity')",
      [orderId, registrationId, ownerId, addonOrder],
    );
    await f.admin.query(
      "INSERT INTO confsys.activity_versions(id,version,document,created_by) VALUES($1,1,$2,$3)",
      [activityId, { name: "合成午餐", capacity: 5 }, staffId],
    );
    await f.admin.query(
      "INSERT INTO confsys.activities(id,version) VALUES($1,1)",
      [activityId],
    );
    await f.admin.query(
      "INSERT INTO confsys.activity_bookings(id,registration_id,user_id,activity_id,activity_version,quantity,meal_type,state,order_id,snapshot,idempotency_key,request_hash) VALUES($1,$2,$3,$4,1,1,'vegetarian','reserved',$5,$6,$7,'synthetic')",
      [
        bookingId,
        registrationId,
        ownerId,
        activityId,
        addonOrder,
        { name: "合成午餐", capacity: 5 },
        randomUUID(),
      ],
    );
    await page.goto(`/onsite/pass?registrationId=${registrationId}`);
    await expect(
      page.getByLabel("報名 ID（我的報名頁面）", { exact: true }),
    ).toHaveValue(registrationId);
    await page.getByRole("button", { name: "顯示報到碼", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "現場報到 QR 碼" }),
    ).toBeVisible();
    const token = await page
      .getByLabel("報到碼文字", { exact: true })
      .inputValue();
    expect(token).toMatch(/^cs1_/);
    await staff.goto("/admin/onsite");
    await staff
      .getByLabel("掃描器輸入／貼上報到碼", { exact: true })
      .fill(token);
    await staff
      .getByRole("button", { name: "查詢參與者", exact: true })
      .click();
    await expect(staff.getByRole("heading", { name: /陳怡君/ })).toBeVisible();
    await staff.getByRole("button", { name: "確認報到", exact: true }).click();
    await expect(staff.getByRole("status")).toContainText("報到已確認");
    await staff.getByRole("button", { name: "確認核銷", exact: true }).click();
    await expect(staff.getByRole("status")).toContainText("核銷已確認");
    await expect(staff.getByText(/合成午餐.*已核銷 1／1/)).toBeVisible();
    await staff
      .getByLabel("查詢名單（名牌姓名／報名編號）", { exact: true })
      .fill("陳怡君");
    await staff.getByRole("button", { name: "搜尋", exact: true }).click();
    await staff.getByRole("checkbox", { name: /選取.*陳怡君/ }).check();
    await staff
      .getByRole("button", { name: "製作所選名牌（1／100）", exact: true })
      .click();
    await expect(
      staff.getByRole("heading", { name: "批次名牌 PDF", exact: true }),
    ).toBeVisible();
    await staff.getByRole("button", { name: "建立批次", exact: true }).click();
    await expect(
      staff.getByRole("button", { name: "下載 PDF", exact: true }),
    ).toBeEnabled({ timeout: 15000 });
    const downloadPromise = staff.waitForEvent("download");
    await staff.getByRole("button", { name: "下載 PDF", exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^badges-.*\.pdf$/);
    expect(await download.failure()).toBeNull();
  } finally {
    await staffContext.close();
  }
});

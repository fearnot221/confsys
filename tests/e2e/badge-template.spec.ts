import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
import { authFixture } from "../helpers/auth.js";
import { register, login } from "../helpers/browser-account.js";
const f = authFixture();
let adminId: string | undefined,
  previousVersion: number | null = null;
test.afterAll(async () => {
  await f.admin.query(
    "UPDATE confsys.badge_template_state SET current_version=$1",
    [previousVersion],
  );
  if (adminId)
    await f.admin.query(
      "DELETE FROM confsys.badge_template_versions WHERE created_by=$1",
      [adminId],
    );
  await f.cleanup();
});
test("administrator saves bounded badge template and downloads synthetic PDF preview", async ({
  page,
}) => {
  previousVersion = (
    await f.admin.query(
      "SELECT current_version FROM confsys.badge_template_state",
    )
  ).rows[0].current_version;
  const email = f.email();
  await register(page, email);
  await login(page, email);
  adminId = (await (await page.request.get("/api/auth/me")).json()).user.id;
  await bootstrapAdministrator(
    f.admin,
    {
      conferenceName: f.config.CONFERENCE_NAME,
      origin: f.config.PUBLIC_APP_ORIGIN,
    },
    {
      targetId: adminId!,
      apply: true,
      reason: "Synthetic template browser",
      confirmOrigin: f.config.PUBLIC_APP_ORIGIN,
    },
    randomUUID(),
  );
  await login(page, email);
  await page.goto("/admin/badge-template");
  await expect(
    page.getByRole("heading", { name: "名牌模板", exact: true }),
  ).toBeVisible();
  await page.getByLabel("尺寸", { exact: true }).selectOption("credit_card");
  await page.getByLabel("文字排列", { exact: true }).selectOption("left");
  await page
    .getByLabel("頁尾文字（需能容納單行）", { exact: true })
    .fill("合成預覽");
  await page.getByRole("button", { name: "儲存新版本", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("已儲存模板版本");
  await page.reload();
  await expect(page.getByLabel("尺寸", { exact: true })).toHaveValue(
    "credit_card",
  );
  const downloaded = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "下載已儲存模板預覽", exact: true })
    .click();
  expect((await downloaded).suggestedFilename()).toBe(
    "badge-template-preview.pdf",
  );
  const response = await page.request.get("/api/badge-template/preview");
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

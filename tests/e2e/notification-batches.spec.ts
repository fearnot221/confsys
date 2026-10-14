import { test, expect } from "../helpers/browser-test.js";
import { register, login } from "../helpers/browser-account.js";
import { authFixture } from "../helpers/auth.js";
const f = authFixture();
test.afterAll(async () => {
  const ids = (
    await f.admin.query<{ id: string }>(
      "SELECT id FROM confsys.users WHERE email LIKE $1",
      [`${f.prefix}%`],
    )
  ).rows.map((r) => r.id);
  await f.admin.query(
    "DELETE FROM confsys.notifications WHERE batch_id IN(SELECT id FROM confsys.notification_batches WHERE created_by=ANY($1::uuid[]))",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.notification_batches WHERE created_by=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.notification_template_versions WHERE created_by=ANY($1::uuid[])",
    [ids],
  );
  await f.cleanup();
});
test("admin explicitly queues a bounded batch and the real worker sends to Mailpit and recipient center", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const adminEmail = f.email(),
    recipientEmail = f.email();
  await register(page, adminEmail);
  await register(page, recipientEmail);
  const users = (
    await f.admin.query<{ id: string; email: string }>(
      "SELECT id,email FROM confsys.users WHERE email=ANY($1::text[])",
      [[adminEmail, recipientEmail]],
    )
  ).rows;
  const adminId = users.find((u) => u.email === adminEmail)!.id,
    recipientId = users.find((u) => u.email === recipientEmail)!.id;
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
    [adminId],
  );
  await login(page, adminEmail);
  await page.goto("/admin/notifications");
  await page.getByRole("button", { name: "預覽受眾", exact: true }).click();
  await page
    .getByRole("checkbox", { name: recipientEmail, exact: true })
    .check();
  await page
    .getByRole("button", { name: "採用勾選的 1 位收件者", exact: true })
    .click();
  await expect(page.getByLabel("收件人本地帳號 UUID（每行一個）")).toHaveValue(
    recipientId,
  );
  await page.getByLabel("通知主旨").fill("Synthetic batch browser");
  await page
    .getByLabel("通知本文")
    .fill("Synthetic general conference announcement.");
  await page
    .getByLabel("範本識別字", { exact: true })
    .fill(`browser-${adminId}`);
  await page
    .getByLabel("範本名稱", { exact: true })
    .fill("Synthetic browser template");
  await page
    .getByRole("button", { name: "保存範本新版本", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "已保存不可變的範本新版本",
  );
  await page
    .getByRole("button", {
      name: "套用範本：Synthetic browser template v1",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "儲存並排入通知佇列" }).click();
  await expect(page.getByRole("status")).toContainText(
    "通知批次已保存並排入佇列",
  );
  await expect
    .poll(
      async () => {
        const result = await fetch(
          `${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${recipientEmail}`)}`,
        ).then((r) => r.json());
        return result.messages.some((m: { Subject: string }) =>
          m.Subject.includes("Synthetic batch browser"),
        );
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await page.getByRole("button", { name: "重新整理批次狀態" }).click();
  await expect(page.getByText("SMTP 已接受：1", { exact: true })).toBeVisible();
  await page
    .getByRole("button", {
      name: "查看寄送明細：Synthetic batch browser",
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("region", { name: "批次寄送明細" }),
  ).toContainText("SMTP_ACCEPTED");
  await expect(
    page.getByRole("region", { name: "批次寄送明細" }),
  ).toContainText(recipientEmail);
  const context = await browser.newContext({
    baseURL: process.env.PUBLIC_APP_ORIGIN!,
  });
  try {
    const recipient = await context.newPage();
    await login(recipient, recipientEmail);
    await recipient.goto("/notifications");
    await expect(
      recipient.getByRole("heading", { name: "Synthetic batch browser" }),
    ).toBeVisible();
    await expect(
      recipient.getByText("Synthetic general conference announcement.", {
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("通知主旨", { exact: true })
      .fill("Synthetic scheduled future notice");
    await page
      .getByLabel("通知本文", { exact: true })
      .fill("FUTURE_PRIVATE_BATCH_CONTENT");
    await page
      .getByLabel("預約寄送時間（UTC ISO，留空立即；最多30日）", {
        exact: true,
      })
      .fill(new Date(Date.now() + 3600000).toISOString());
    await page
      .getByRole("button", { name: "儲存並排入通知佇列", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Synthetic scheduled future notice",
        exact: true,
      }),
    ).toBeVisible();
    await recipient.reload();
    await expect(
      recipient.getByText("FUTURE_PRIVATE_BATCH_CONTENT", { exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", {
        name: "取消待寄送：Synthetic scheduled future notice",
        exact: true,
      })
      .click();
    await expect(page.getByRole("status")).toContainText("已要求取消");
    await recipient.reload();
    await expect(
      recipient.getByText("FUTURE_PRIVATE_BATCH_CONTENT", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await context.close();
  }
});

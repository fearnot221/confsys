import { test, expect } from "@playwright/test";
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
  await page.getByLabel("收件人本地帳號 UUID（每行一個）").fill(recipientId);
  await page.getByLabel("通知主旨").fill("Synthetic batch browser");
  await page
    .getByLabel("通知本文")
    .fill("Synthetic general conference announcement.");
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
  } finally {
    await context.close();
  }
});

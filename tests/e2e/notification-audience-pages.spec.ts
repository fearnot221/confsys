import { test, expect } from "../helpers/browser-test.js";
import { randomUUID } from "node:crypto";
import { authFixture } from "../helpers/auth.js";
import { register, login } from "../helpers/browser-account.js";
const f = authFixture();
let adminId: string;
const ownIds: string[] = [];
test.afterAll(async () => {
  if (adminId) {
    await f.admin.query(
      "DELETE FROM confsys.notifications WHERE batch_id IN(SELECT id FROM confsys.notification_batches WHERE created_by=$1)",
      [adminId],
    );
    await f.admin.query(
      "DELETE FROM confsys.notification_batches WHERE created_by=$1",
      [adminId],
    );
  }
  await f.cleanup();
});
test("administrator pages beyond 100, replaces selection explicitly and sends only the chosen later-page recipient", async ({
  page,
}) => {
  test.setTimeout(60000);
  const email = f.email();
  await register(page, email);
  adminId = (
    await f.admin.query("SELECT id FROM confsys.users WHERE email=$1", [email])
  ).rows[0].id;
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
    [adminId],
  );
  for (let i = 0; i < 103; i++) {
    const id = randomUUID();
    ownIds.push(id);
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
  const expected = (
    await f.admin.query<{ id: string; email: string }>(
      "SELECT u.id,u.email FROM confsys.users u JOIN confsys.user_roles r ON r.user_id=u.id WHERE r.role='onsite' AND u.state='active' AND u.verified_at IS NOT NULL ORDER BY u.email,u.id",
    )
  ).rows;
  const targetIndex = expected.findIndex(
      (r, index) => index >= 100 && ownIds.includes(r.id),
    ),
    target = expected[targetIndex]!;
  expect(targetIndex).toBeGreaterThanOrEqual(100);
  expect(targetIndex).toBeLessThan(1000);
  await login(page, email);
  await page.goto("/admin/notifications");
  const panel = page.getByRole("region", { name: "通知受眾預覽" });
  await panel.getByLabel("角色篩選", { exact: true }).selectOption("onsite");
  await panel.getByRole("button", { name: "預覽受眾", exact: true }).click();
  await expect(panel.getByRole("checkbox")).toHaveCount(100);
  await panel.getByRole("checkbox").first().check();
  await expect(
    panel.getByRole("button", { name: "採用勾選的 1 位收件者", exact: true }),
  ).toBeEnabled();
  for (let n = 0; n < Math.floor(targetIndex / 100); n++) {
    await panel
      .getByRole("button", { name: "下一頁受眾", exact: true })
      .click();
    await expect(panel).toContainText(`第 ${n + 2} 頁`);
  }
  await expect(
    panel.getByRole("button", { name: "採用勾選的 0 位收件者", exact: true }),
  ).toBeDisabled();
  await panel
    .getByRole("checkbox", { name: target.email, exact: true })
    .check();
  await panel
    .getByRole("button", { name: "採用勾選的 1 位收件者", exact: true })
    .click();
  await expect(page.getByLabel("收件人本地帳號 UUID（每行一個）")).toHaveValue(
    target.id,
  );
  await page
    .getByLabel("通知主旨", { exact: true })
    .fill("Synthetic later-page selection");
  await page
    .getByLabel("通知本文", { exact: true })
    .fill("Synthetic notice selected beyond the first hundred accounts.");
  await page
    .getByRole("button", { name: "儲存並排入通知佇列", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "通知批次已保存並排入佇列",
  );
  const batch = (
    await f.admin.query(
      "SELECT id,recipient_ids FROM confsys.notification_batches WHERE created_by=$1",
      [adminId],
    )
  ).rows;
  expect(batch).toHaveLength(1);
  expect(batch[0].recipient_ids).toEqual([target.id]);
  await expect
    .poll(
      async () => {
        const result = await fetch(
          `${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${target.email}`)}`,
        ).then((r) => r.json());
        return result.messages.some((m: { Subject: string }) =>
          m.Subject.includes("Synthetic later-page selection"),
        );
      },
      { timeout: 15000 },
    )
    .toBe(true);
  await panel.getByRole("button", { name: "上一頁受眾", exact: true }).click();
  await expect(panel).toContainText(`第 ${Math.floor(targetIndex / 100)} 頁`);
  await expect(
    panel.getByRole("button", { name: "採用勾選的 0 位收件者", exact: true }),
  ).toBeDisabled();
});

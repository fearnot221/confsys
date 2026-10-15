import { test, expect } from "../helpers/browser-test.js";
import { randomUUID } from "node:crypto";
import { withIdentityTransaction } from "@confsys/db";
import { enqueueBusinessNotification } from "@confsys/notifications";
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
    "DELETE FROM confsys.notification_reads WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.submissions WHERE owner_id=ANY($1::uuid[])",
    [ids],
  );
  await f.cleanup();
});
test("business notification read state, CSV page and controlled author preview operate through UI", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const adminEmail = f.email(),
    authorEmail = f.email();
  await register(page, adminEmail);
  await register(page, authorEmail);
  const users = (
    await f.admin.query<{ id: string; email: string }>(
      "SELECT id,email FROM confsys.users WHERE email=ANY($1::text[])",
      [[adminEmail, authorEmail]],
    )
  ).rows;
  const adminId = users.find((u) => u.email === adminEmail)!.id,
    authorId = users.find((u) => u.email === authorEmail)!.id;
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
    [adminId],
  );
  await f.admin.query(
    "INSERT INTO confsys.submissions(id,owner_id,version,document) VALUES($1,$2,1,$3)",
    [
      randomUUID(),
      authorId,
      JSON.stringify({ title: "Synthetic preview title", trackId: "science" }),
    ],
  );
  await withIdentityTransaction(f.app, (db) =>
    enqueueBusinessNotification(db, f.config, {
      userId: authorId,
      eventKey: randomUUID(),
      subject: "Synthetic browser notice",
      text: "Please open your authenticated dashboard.",
      requestId: randomUUID(),
    }),
  );
  await login(page, authorEmail);
  await page.goto("/notifications");
  await expect(
    page.getByRole("heading", { name: "Synthetic browser notice" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "標示已讀：Synthetic browser notice" })
    .click();
  await expect(page.getByRole("status")).toContainText("已標示為已讀");
  await expect(
    page.getByRole("heading", { name: "受控作者視角預覽" }),
  ).toHaveCount(0);
  const adminContext = await browser.newContext({
    baseURL: process.env.PUBLIC_APP_ORIGIN!,
  });
  try {
    const p = await adminContext.newPage();
    await login(p, adminEmail);
    await p.goto("/notifications");
    await p.getByLabel("匯出資料").selectOption("submissions");
    await p
      .getByLabel("匯出用途", { exact: true })
      .fill("Synthetic author support reconciliation");
    await p.getByRole("button", { name: "產生第一頁 CSV" }).click();
    await expect(
      p.getByRole("link", { name: /下載 submissions/ }),
    ).toBeVisible();
    const link = await p
      .getByRole("link", { name: /下載 submissions/ })
      .getAttribute("href");
    expect(decodeURIComponent(link!)).toContain("Synthetic preview title");
    await p.getByLabel("作者本地帳號 UUID").fill(authorId);
    await p.getByLabel("查閱原因").fill("Synthetic browser support");
    await p.getByRole("button", { name: "開啟唯讀預覽" }).click();
    await expect(
      p.getByRole("heading", { name: `唯讀預覽：${authorEmail}` }),
    ).toBeVisible();
    await expect(
      p.getByText("Synthetic preview title", { exact: false }),
    ).toBeVisible();
    expect((await (await p.request.get("/api/auth/me")).json()).user.id).toBe(
      adminId,
    );
    await p.getByRole("button", { name: "關閉預覽" }).click();
    await expect(
      p.getByRole("heading", { name: `唯讀預覽：${authorEmail}` }),
    ).toHaveCount(0);
  } finally {
    await adminContext.close();
  }
});

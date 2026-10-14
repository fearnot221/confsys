import { test, expect } from "@playwright/test";
import { register, login } from "../helpers/browser-account.js";
import { authFixture, password } from "../helpers/auth.js";
const f = authFixture();
test.afterAll(async () => {
  await f.admin.query(
    "DELETE FROM confsys.notification_secrets WHERE notification_id IN (SELECT n.id FROM confsys.notifications n JOIN confsys.users u ON u.id=n.user_id WHERE u.email LIKE $1)",
    [`${f.prefix}%`],
  );
  await f.admin.query(
    "DELETE FROM confsys.notifications WHERE user_id IN (SELECT id FROM confsys.users WHERE email LIKE $1)",
    [`${f.prefix}%`],
  );
  await f.admin.query(
    "DELETE FROM confsys.role_invitations WHERE user_id IN (SELECT id FROM confsys.users WHERE email LIKE $1)",
    [`${f.prefix}%`],
  );
  await f.cleanup();
});
test("admin invitation email leads verified recipient to explicit acceptance and renewed local access", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  const admin = f.email(),
    recipient = f.email();
  await register(page, admin);
  await register(page, recipient);
  await login(page, admin);
  const administrator = (await (await page.request.get("/api/auth/me")).json())
    .user;
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES ($1,'conference_admin')",
    [administrator.id],
  );
  await page.goto("/admin/invitations");
  await expect(
    page.getByRole("heading", { name: "本研討會角色邀請" }),
  ).toBeVisible();
  await page.getByLabel("已驗證的本地 Email").fill(recipient);
  await page
    .getByRole("combobox", { name: "角色", exact: true })
    .selectOption("conference_staff");
  await page.getByLabel("建立／撤銷理由").fill("Synthetic browser invitation");
  await page.getByRole("button", { name: "建立並排入郵件佇列" }).click();
  await expect(page.getByRole("status")).toContainText("邀請已建立");
  let messageId: string | undefined;
  await expect
    .poll(
      async () => {
        const result = await fetch(
          `${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`,
        ).then((r) => r.json());
        messageId = result.messages.find((m: { Subject: string; ID: string }) =>
          m.Subject.includes("Conference role invitation"),
        )?.ID;
        return !!messageId;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const message = await fetch(
    `${process.env.MAILPIT_URL}/api/v1/message/${messageId}`,
  ).then((r) => r.json());
  const link = String(message.Text).match(
    /http:\/\/[^\s]+\/auth\/invitation#token=[A-Za-z0-9_-]+/,
  )?.[0];
  if (!link) throw new Error("Missing invitation link");
  const context = await browser.newContext({
    baseURL: process.env.PUBLIC_APP_ORIGIN!,
  });
  const recipientPage = await context.newPage();
  try {
    await login(recipientPage, recipient);
    await recipientPage.goto(link);
    await expect(
      recipientPage.getByRole("heading", { name: "接受本研討會角色邀請" }),
    ).toBeVisible();
    await expect.poll(() => recipientPage.url()).not.toContain("token=");
    expect(
      (await (await recipientPage.request.get("/api/auth/me")).json()).user
        .roles,
    ).toEqual([]);
    await recipientPage.getByLabel("目前密碼").fill(password);
    await recipientPage
      .getByRole("button", { name: "確認接受角色邀請" })
      .click();
    await expect(recipientPage.getByRole("status")).toContainText("已接受邀請");
    expect((await recipientPage.request.get("/api/auth/me")).status()).toBe(
      401,
    );
    await login(recipientPage, recipient);
    expect(
      (await (await recipientPage.request.get("/api/auth/me")).json()).user
        .roles,
    ).toEqual(["conference_staff"]);
    await recipientPage.goto("/admin/invitations");
    await expect(recipientPage.getByRole("alert")).toContainText(
      "沒有管理邀請的權限",
    );
    await expect(recipientPage.getByLabel("已驗證的本地 Email")).toHaveCount(0);
  } finally {
    await context.close();
  }
});

import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
const password = "Browser conference phrase 918!";
const replacement = "Updated browser phrase 173!";
async function mailLink(email: string, kind: "verify" | "reset") {
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const result = await fetch(
          `http://127.0.0.1:28025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        ).then((r) => r.json());
        const messages: { ID: string; Subject: string }[] = result.messages;
        id = messages.find((message) =>
          message.Subject.includes(
            kind === "verify" ? "Verify email" : "Reset password",
          ),
        )?.ID;
        return !!id;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const message = await fetch(
    `http://127.0.0.1:28025/api/v1/message/${id}`,
  ).then((r) => r.json());
  const match = String(message.Text).match(
    /http:\/\/127\.0\.0\.1:25173\/auth\/(?:verify|reset)#token=[A-Za-z0-9_-]+/,
  );
  if (!match) throw new Error("Mailpit link missing");
  return match[0];
}
async function register(page: Page, email: string) {
  await page.goto("/auth/register");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByRole("button", { name: "申請郵件" }).click();
  await expect(page.getByRole("status")).toContainText("寄送要求已受理");
  await page.getByRole("button", { name: "重寄驗證信", exact: true }).click();
  await expect
    .poll(
      async () => {
        const result = await fetch(
          `http://127.0.0.1:28025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        ).then((r) => r.json());
        return result.messages.length;
      },
      { timeout: 15000 },
    )
    .toBe(2);
  const link = await mailLink(email, "verify");
  await page.goto(link);
  await page.reload(); // GET/reload does not consume the token.
  await page.getByLabel("新密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "確認並啟用帳號" }).click();
  await expect(page.getByRole("status")).toContainText("信箱驗證完成");
  return link;
}
async function login(page: Page, email: string, value = password) {
  await page.goto("/auth/login");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼", { exact: true }).fill(value);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByTestId("account-email")).toHaveText(email);
}
test("real registration → Mailpit → verification → login → reload → logout, then reset invalidates old password and sessions", async ({
  page,
  browser,
}) => {
  const email = `e2e-${randomUUID()}@example.invalid`;
  const original = await register(page, email);
  await login(page, email);
  await page.reload();
  await expect(page.getByTestId("account-email")).toHaveText(email);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  const oldContext = await browser.newContext();
  const oldPage = await oldContext.newPage();
  await oldPage.goto("http://127.0.0.1:25173/auth/login");
  await oldPage.getByLabel("電子郵件").fill(email);
  await oldPage.getByLabel("密碼", { exact: true }).fill(password);
  await oldPage.getByRole("button", { name: "登入", exact: true }).click();
  await expect(oldPage.getByTestId("account-email")).toHaveText(email);
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  await page.goto("/auth/forgot");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByRole("button", { name: "申請郵件" }).click();
  await expect(page.getByRole("status")).toContainText("寄送要求已受理");
  const reset = await mailLink(email, "reset");
  await page.goto(reset);
  await page.getByLabel("新密碼", { exact: true }).fill(replacement);
  await page.getByRole("button", { name: "重設密碼", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("既有登入已撤銷");
  await oldPage.getByRole("button", { name: "重新確認" }).click();
  await expect(oldPage.getByRole("alert")).toContainText("登入已逾期");
  await expect(oldPage.getByTestId("account-email")).toHaveCount(0);
  await oldContext.close();
  await page.goto("/auth/login");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("信箱或密碼不正確");
  await login(page, email, replacement);
  await page.goto(original);
  await page.getByLabel("新密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "確認並啟用帳號" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "連結已過期、已使用或無效",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/phase1-auth-mobile.png",
    fullPage: true,
  });
});
test("account A logout → B login clears private cache; late A response cannot restore A", async ({
  page,
}) => {
  const a = `e2e-a-${randomUUID()}@example.invalid`,
    b = `e2e-b-${randomUUID()}@example.invalid`;
  await register(page, a);
  await register(page, b);
  await login(page, a);
  let release!: () => void;
  let started!: () => void;
  let finished!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const intercepted = new Promise<void>((resolve) => {
    started = resolve;
  });
  const handled = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route("**/api/auth/me", async (route) => {
    const response = await route.fetch();
    started();
    await pending;
    // The request may already be cancelled by logout/navigation.
    try {
      await route.fulfill({ response });
    } catch (error) {
      expect(String(error)).toMatch(/Target|closed|already handled/);
    } finally {
      finished();
    }
  });
  await page.getByRole("button", { name: "重新確認" }).click();
  await intercepted;
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page).toHaveURL(/\/auth\/login$/);
  release();
  await handled;
  await page.unroute("**/api/auth/me");
  await login(page, b);
  await expect(page.getByText(a, { exact: true })).toHaveCount(0);
  await page.screenshot({
    path: "test-results/phase1-account-desktop.png",
    fullPage: true,
  });
});
test("invalid links, unavailable network, retry and anonymous resend have usable states", async ({
  page,
}) => {
  await page.goto("/auth/reset#token=invalid");
  await page.getByLabel("新密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "重設密碼", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await page.goto("/auth/waiting");
  await page
    .getByLabel("電子郵件")
    .fill(`e2e-unknown-${randomUUID()}@example.invalid`);
  await page.route("**/api/auth/csrf", (route) => route.abort());
  await page.getByRole("button", { name: "申請郵件" }).click();
  await expect(page.getByRole("alert")).toContainText("網路");
  await page.unroute("**/api/auth/csrf");
  await page.getByRole("button", { name: "申請郵件" }).click();
  await expect(page.getByRole("status")).toContainText("寄送要求已受理");
});

import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
// Fixed loopback capture stack; never accepts a production URL/recipient.
const origin = "http://127.0.0.1:25173";
const email = `container-smoke-${randomUUID()}@example.invalid`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(`${origin}/auth/register`);
  await page.getByLabel("電子郵件").fill(email);
  await page.getByRole("button", { name: "申請郵件" }).click();
  await expect(page.getByRole("status")).toContainText("寄送要求已受理");
  let messageId: string | undefined;
  await expect
    .poll(
      async () => {
        const response = await fetch(
          `http://127.0.0.1:28025/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        );
        const body: { messages: { ID: string }[] } = await response.json();
        messageId = body.messages[0]?.ID;
        return !!messageId;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const detail: { Text: string } = await fetch(
    `http://127.0.0.1:28025/api/v1/message/${messageId}`,
  ).then((r) => r.json());
  const link = detail.Text.match(
    /http:\/\/127\.0\.0\.1:25173\/auth\/verify#token=[A-Za-z0-9_-]+/,
  )?.[0];
  if (!link) throw new Error("Capture verification link missing");
  await page.goto(link);
  const password = `Synthetic smoke phrase ${randomUUID()}`;
  await page.getByLabel("新密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "確認並啟用帳號" }).click();
  await expect(page.getByRole("status")).toContainText("信箱驗證完成");
  await page.goto(`${origin}/auth/login`);
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByTestId("account-email")).toHaveText(email);
  await page.reload();
  await expect(page.getByTestId("account-email")).toHaveText(email);
  await page.screenshot({
    path: "test-results/phase1-container.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "登出", exact: true }).click();
  await expect(page).toHaveURL(`${origin}/auth/login`);
  console.log(
    "Container Web/CSRF/cookies/API/worker/Mailpit lifecycle verified",
  );
} finally {
  await browser.close();
}

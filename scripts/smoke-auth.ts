import { chromium, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { isLocalHostname, loadLocalConfig } from "@confsys/config";
// Only selected local capture stacks; never production recipients or URLs.
loadLocalConfig();
const origin = process.env.PUBLIC_APP_ORIGIN!;
if (
  !origin ||
  new URL(origin).protocol !== "http:" ||
  !isLocalHostname(new URL(origin).hostname)
)
  throw new Error("Local HTTP origin required");
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
          `${process.env.MAILPIT_URL ?? "http://127.0.0.1:28025"}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        );
        const body: { messages: { ID: string }[] } = await response.json();
        messageId = body.messages[0]?.ID;
        return !!messageId;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const detail: { Text: string } = await fetch(
    `${process.env.MAILPIT_URL ?? "http://127.0.0.1:28025"}/api/v1/message/${messageId}`,
  ).then((r) => r.json());
  const link = detail.Text.match(
    /http:\/\/[^\s]+\/auth\/verify#token=[A-Za-z0-9_-]+/,
  )?.[0];
  if (!link || new URL(link).origin !== origin)
    throw new Error("Canonical capture verification link missing");
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

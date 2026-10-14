import { expect, type Page } from "@playwright/test";
import { password } from "./auth.js";
export async function register(page: Page, email: string) {
  await page.goto("/auth/register");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByRole("button", { name: "申請郵件" }).click();
  await expect(page.getByRole("status")).toContainText("寄送要求已受理");
  let id: string | undefined;
  await expect
    .poll(
      async () => {
        const result = await fetch(
          `${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        ).then((r) => r.json());
        id = result.messages.find((m: { ID: string; Subject: string }) =>
          m.Subject.includes("Verify email"),
        )?.ID;
        return !!id;
      },
      { timeout: 15000 },
    )
    .toBe(true);
  const message = await fetch(
    `${process.env.MAILPIT_URL}/api/v1/message/${id}`,
  ).then((r) => r.json());
  const link = String(message.Text).match(
    /http:\/\/[^\s]+\/auth\/verify#token=[A-Za-z0-9_-]+/,
  )?.[0];
  if (!link) throw new Error("Missing capture link");
  await page.goto(link);
  await page.getByLabel("新密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "確認並啟用帳號" }).click();
  await expect(page.getByRole("status")).toContainText("信箱驗證完成");
}
export async function login(page: Page, email: string) {
  await page.goto("/auth/login");
  await page.getByLabel("電子郵件").fill(email);
  await page.getByLabel("密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "登入", exact: true }).click();
  await expect(page.getByTestId("account-email")).toHaveText(email);
}

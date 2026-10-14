import { register, login } from "../helpers/browser-account.js";
import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { authFixture, password } from "../helpers/auth.js";
const f = authFixture();
let adminEmail: string, targetEmail: string, adminId: string;
async function select(page: Page, email: string) {
  await page.getByLabel("搜尋信箱").fill(email);
  await page.getByRole("button", { name: "搜尋", exact: true }).click();
  await page.getByRole("button", { name: email, exact: true }).click();
  await expect(
    page.getByRole("heading", { name: email, exact: true }),
  ).toBeVisible();
}
async function action(page: Page, value: string, role?: string) {
  await page.getByLabel("管理操作").selectOption(value);
  if (role) await page.getByLabel("角色", { exact: true }).selectOption(role);
  await page
    .getByLabel("操作理由（不含秘密）")
    .fill("synthetic browser administration");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "確認執行" }).click();
  await expect(page.getByRole("status")).toContainText("操作完成");
}
test.afterAll(() => f.cleanup());
test("registration, real CLI bootstrap, admin grants, staff read-only, revoke, disable/restore and audit are usable", async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  adminEmail = f.email();
  targetEmail = f.email();
  await register(page, adminEmail);
  await register(page, targetEmail);
  await login(page, adminEmail);
  await expect(
    page.getByRole("link", { name: "帳號管理", exact: true }),
  ).toHaveCount(0);
  adminId = (await (await page.request.get("/api/auth/me")).json()).user.id;
  const cli = (apply: boolean) =>
    execFileSync(
      process.execPath,
      [
        "--conditions=development",
        "--import",
        "tsx",
        "scripts/bootstrap-admin.ts",
        "--user-id",
        adminId,
        ...(apply
          ? [
              "--apply",
              "--reason",
              "synthetic E2E initialization",
              "--confirm-origin",
              process.env.PUBLIC_APP_ORIGIN!,
            ]
          : []),
      ],
      {
        env: {
          ...process.env,
          MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL,
        },
        encoding: "utf8",
      },
    );
  expect(JSON.parse(cli(false)).changed).toBe(false);
  expect(JSON.parse(cli(true)).changed).toBe(true);
  await page.getByRole("button", { name: "重新確認" }).click();
  await expect(page.getByRole("alert")).toContainText("登入已逾期");
  await login(page, adminEmail);
  await page.getByRole("link", { name: "帳號管理", exact: true }).click();
  await select(page, targetEmail);
  await action(page, "grant", "conference_staff");
  const context = await browser.newContext({
    baseURL: process.env.PUBLIC_APP_ORIGIN!,
  });
  const staff = await context.newPage();
  await login(staff, targetEmail);
  await staff.getByRole("link", { name: "帳號管理", exact: true }).click();
  await select(staff, adminEmail);
  await expect(staff.getByLabel("管理操作")).toHaveCount(0);
  await expect(staff.getByRole("heading", { name: "安全稽核" })).toHaveCount(0);
  await page.getByLabel("目前密碼").fill(password);
  await page.getByRole("button", { name: "重新驗證密碼" }).click();
  await expect(page.getByRole("status")).toContainText("密碼已重新驗證");
  await select(page, targetEmail);
  await action(page, "revoke", "conference_staff");
  await staff.getByRole("button", { name: "重試／重新整理" }).click();
  await expect(staff.getByRole("alert")).toContainText("登入已逾期");
  await select(page, targetEmail);
  await action(page, "disable");
  await staff.goto("/auth/login");
  await staff.getByLabel("電子郵件").fill(targetEmail);
  await staff.getByLabel("密碼", { exact: true }).fill(password);
  await staff.getByRole("button", { name: "登入", exact: true }).click();
  await expect(staff.getByRole("alert")).toContainText("信箱或密碼不正確");
  await select(page, targetEmail);
  await action(page, "restore");
  await login(staff, targetEmail);
  await expect(
    staff.getByRole("link", { name: "帳號管理", exact: true }),
  ).toHaveCount(0);
  await select(page, targetEmail);
  await action(page, "grant", "conference_admin");
  await login(staff, targetEmail);
  await staff.getByRole("link", { name: "帳號管理", exact: true }).click();
  await expect(staff.getByRole("heading", { name: "安全稽核" })).toBeVisible();
  await select(page, targetEmail);
  await action(page, "revoke_sessions");
  await staff.getByRole("button", { name: "重試／重新整理" }).click();
  await expect(staff.getByRole("alert")).toContainText("登入已逾期");
  await expect(
    page.getByText("access.grant", { exact: false }).first(),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/phase1-2-admin.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/phase1-2-mobile.png",
    fullPage: true,
  });
  await context.close();
});
test("revoked admin clears private directory and ignores a late response; ordinary direct URL is denied", async ({
  page,
}) => {
  await login(page, adminEmail);
  await page.goto("/access/accounts");
  await select(page, targetEmail);
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (started = r));
  await page.route("**/api/access/accounts?**", async (route) => {
    const response = await route.fetch();
    started();
    await gate;
    try {
      await route.fulfill({ response });
    } catch (e) {
      expect(String(e)).toMatch(/Target|closed|already handled/);
    }
  });
  await page.getByRole("button", { name: "搜尋", exact: true }).click(); // same search might remain fresh; explicit refresh follows
  await page.getByRole("button", { name: "重試／重新整理" }).click();
  await ready;
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  const result = await page.request.post("/api/auth/logout", {
    data: {},
    headers: {
      origin: process.env.PUBLIC_APP_ORIGIN!,
      "x-csrf-token": csrf.csrfToken,
    },
  });
  expect(result.status()).toBe(200);
  await page.getByRole("button", { name: "重試／重新整理" }).click();
  await expect(page.getByRole("alert")).toContainText("登入已逾期");
  release();
  await page.unroute("**/api/access/accounts?**");
  await expect(page.getByText(targetEmail, { exact: true })).toHaveCount(0);
  const ordinary = f.email();
  await register(page, ordinary);
  await login(page, ordinary);
  await page.goto("/access/accounts");
  await expect(page.getByRole("alert")).toContainText("沒有帳號目錄權限");
  expect((await page.request.get("/api/access/accounts")).status()).toBe(403);
});

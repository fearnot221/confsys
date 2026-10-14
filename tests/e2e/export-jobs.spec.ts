import { test, expect } from "../helpers/browser-test.js";
import { readFile } from "node:fs/promises";
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
    "DELETE FROM confsys.export_jobs WHERE requester_id=ANY($1::uuid[])",
    [ids],
  );
  await f.cleanup();
});
test("administrator creates durable full CSV export, observes real worker completion and downloads verified data", async ({
  page,
}) => {
  test.setTimeout(60000);
  const email = f.email();
  await register(page, email);
  await login(page, email);
  const actor = (await (await page.request.get("/api/auth/me")).json()).user;
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
    [actor.id],
  );
  await page.goto("/admin/exports");
  await page
    .getByRole("combobox", { name: "完整匯出資料集", exact: true })
    .selectOption("emails");
  await page
    .getByLabel("匯出用途", { exact: true })
    .fill("Synthetic conference operations reconciliation");
  await page.getByRole("button", { name: "建立背景匯出工作" }).click();
  await expect(page.getByRole("status")).toContainText("匯出工作已保存");
  await expect
    .poll(
      async () => {
        await page.getByRole("button", { name: "重新整理匯出狀態" }).click();
        return page
          .getByRole("heading", { name: "emails · 可下載", exact: true })
          .count();
      },
      { timeout: 15000 },
    )
    .toBe(1);
  await page.getByRole("button", { name: /驗證並取得 CSV：/ }).click();
  await expect(
    page.getByRole("link", { name: "下載已驗證 CSV" }),
  ).toBeVisible();
  const downloaded = page.waitForEvent("download");
  await page.getByRole("link", { name: "下載已驗證 CSV" }).click();
  const file = await downloaded,
    path = await file.path();
  expect(path).not.toBeNull();
  const csv = await readFile(path!, "utf8");
  expect(csv).toContain(email);
  expect(csv).toContain('"user_id","email"');
  expect(csv).not.toMatch(/password_hash|token_hash/);
  expect(file.suggestedFilename()).toMatch(/^export-emails-[0-9a-f-]+\.csv$/);
});

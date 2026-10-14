import { test, expect } from "../helpers/browser-test.js";
import { execFileSync } from "node:child_process";
import { authFixture } from "../helpers/auth.js";
import { register, login } from "../helpers/browser-account.js";
const f = authFixture();
let baseline: Record<string, unknown>;
test.beforeAll(async () => {
  baseline = (await f.admin.query("SELECT * FROM confsys.submission_config"))
    .rows[0];
});
test.afterAll(async () => {
  await f.admin.query(
    "UPDATE confsys.submission_config SET version=$1,document=$2",
    [baseline.version, baseline.document],
  );
  const ids = (
    await f.admin.query("SELECT id FROM confsys.users WHERE email LIKE $1", [
      `${f.prefix}%`,
    ])
  ).rows.map((r) => r.id);
  await f.admin.query(
    "UPDATE confsys.submissions SET current_revision_id=null,submitted_version=null,state='draft' WHERE owner_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.submission_revisions WHERE owner_id=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.submissions WHERE owner_id=ANY($1::uuid[])",
    [ids],
  );
  await f.cleanup();
});
test("admin configures real window; author saves, submits, revises, inspects history and withdraws", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const adminEmail = f.email();
  await register(page, adminEmail);
  await login(page, adminEmail);
  const id = (await (await page.request.get("/api/auth/me")).json()).user.id;
  execFileSync(
    process.execPath,
    [
      "--conditions=development",
      "--import",
      "tsx",
      "scripts/bootstrap-admin.ts",
      "--user-id",
      id,
      "--apply",
      "--reason",
      "synthetic submission E2E",
      "--confirm-origin",
      process.env.PUBLIC_APP_ORIGIN!,
    ],
    {
      env: {
        ...process.env,
        MIGRATION_DATABASE_URL: process.env.TEST_MIGRATION_DATABASE_URL,
      },
      stdio: "pipe",
    },
  );
  await login(page, adminEmail);
  await page.goto("/admin/submissions");
  await page.getByText("投稿窗口、主題與必要條件", { exact: true }).click();
  await page
    .getByLabel("開始時間（含 Z 的 UTC ISO 格式）")
    .fill(new Date(Date.now() - 60000).toISOString());
  await page
    .getByLabel("截止時間（UTC，截止瞬間不接受投稿）")
    .fill(new Date(Date.now() + 3600000).toISOString());
  await page.getByRole("button", { name: "新增主題軌", exact: true }).click();
  await page.getByLabel("代碼（小寫英數、連字號）").fill("research");
  await page.getByLabel("名稱", { exact: true }).fill("Research");
  await page.getByRole("button", { name: "新增分類", exact: true }).click();
  await page.getByLabel("分類代碼", { exact: true }).fill("methods");
  await page.getByLabel("分類名稱", { exact: true }).fill("Methods");
  await page.getByRole("button", { name: "儲存投稿設定", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("投稿設定已儲存");
  const authorContext = await browser.newContext({
    baseURL: process.env.PUBLIC_APP_ORIGIN!,
  });
  const author = await authorContext.newPage();
  const authorEmail = f.email();
  await register(author, authorEmail);
  await login(author, authorEmail);
  await author.goto("/submissions");
  await author.getByRole("button", { name: "建立新草稿", exact: true }).click();
  await author.getByLabel("標題", { exact: true }).fill("Synthetic manuscript");
  await author
    .getByLabel("摘要", { exact: true })
    .fill("A synthetic abstract for a real author workflow.");
  await author.getByLabel("主題軌", { exact: true }).selectOption("research");
  await author.getByLabel("Methods", { exact: true }).check();
  await author.getByLabel("姓名", { exact: true }).fill("Synthetic Author");
  await author.getByLabel("Email", { exact: true }).fill(authorEmail);
  await author.getByLabel("單位", { exact: true }).fill("Synthetic Institute");
  await author.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(author.getByRole("status")).toContainText("草稿已儲存");
  const preview = author.getByRole("button", {
    name: "預覽目前草稿",
    exact: true,
  });
  await preview.click();
  await expect(preview).toHaveAttribute("aria-expanded", "true");
  await expect(
    author
      .getByRole("article", { name: "草稿預覽" })
      .getByRole("heading", { name: "Synthetic manuscript", exact: true }),
  ).toBeVisible();
  await preview.click();
  await expect(preview).toHaveAttribute("aria-expanded", "false");
  await author
    .getByRole("button", { name: "正式提交此版本", exact: true })
    .click();
  await author.getByRole("button", { name: "確認", exact: true }).click();
  await expect(author.getByRole("status")).toContainText("正式提交成功");
  await author
    .getByLabel("標題", { exact: true })
    .fill("Synthetic revised manuscript");
  await author.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(author.getByRole("status")).toContainText("草稿已儲存");
  await author.getByRole("button", { name: /版本 1 ·/ }).click();
  await expect(
    author.getByRole("heading", { name: "Synthetic manuscript", exact: true }),
  ).toBeVisible();
  await author
    .getByRole("button", { name: "正式提交此版本", exact: true })
    .click();
  await author.getByRole("button", { name: "確認", exact: true }).click();
  await expect(author.getByRole("status")).toContainText("正式提交成功");
  await expect(author.getByRole("button", { name: /版本 2 ·/ })).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Synthetic revised manuscript", exact: true })
    .click();
  await expect(page.getByLabel("標題", { exact: true })).toBeDisabled();
  await expect(page.getByLabel("標題", { exact: true })).toHaveValue(
    "Synthetic revised manuscript",
  );
  await author.setViewportSize({ width: 390, height: 844 });
  await author.screenshot({
    path: "test-results/phase3-author-mobile.png",
    fullPage: true,
  });
  await author.getByRole("button", { name: "撤回稿件", exact: true }).click();
  await author.getByRole("button", { name: "確認", exact: true }).click();
  await expect(author.getByRole("status")).toContainText("稿件已撤回");
  await expect(
    author.getByRole("button", { name: "儲存草稿", exact: true }),
  ).toBeDisabled();
  await authorContext.close();
});

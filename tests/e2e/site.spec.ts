import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { authFixture } from "../helpers/auth.js";
import { register, login } from "../helpers/browser-account.js";
const f = authFixture();
let email: string;
let baseline: Record<string, unknown>;
test.beforeAll(async () => {
  baseline = (await f.admin.query("SELECT * FROM confsys.site_state")).rows[0];
});
test.afterAll(async () => {
  await f.admin.query(
    "UPDATE confsys.site_state SET draft_version=$1,document=$2,active_publication_id=$3",
    [baseline.draft_version, baseline.document, baseline.active_publication_id],
  );
  await f.admin.query(
    "DELETE FROM confsys.site_publications WHERE published_by IN (SELECT id FROM confsys.users WHERE email LIKE $1)",
    [`${f.prefix}%`],
  );
  await f.cleanup();
});
test("admin edits, saves, conflicts, previews, publishes, changes draft privately and loads history; JS-disabled visitor sees HTML", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  email = f.email();
  await page.goto("/");
  await expect(page.getByText("網站準備中")).toBeVisible();
  await register(page, email);
  await login(page, email);
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
      "synthetic site E2E",
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
  await login(page, email);
  await page.getByRole("link", { name: "會議設定與官網", exact: true }).click();
  await page
    .getByLabel("會議名稱", { exact: true })
    .fill("Synthetic Academic Forum");
  await page.getByLabel("會議開始日期 YYYY-MM-DD").fill("2027-02-28");
  await page.getByLabel("會議結束日期 YYYY-MM-DD").fill("2027-03-01");
  await page.getByLabel("公開聯絡 Email").fill("public@example.invalid");
  await page.getByRole("button", { name: "官網內容", exact: true }).click();
  for (const key of ["home", "about", "participation", "contact"]) {
    await page.getByLabel("頁面", { exact: true }).selectOption(key);
    await page.getByLabel("頁面 title").fill(`Forum ${key}`);
    await page
      .getByLabel("頁面 description")
      .fill(`Academic forum ${key} details`);
    await page.getByLabel("頁面內文").fill(`Public ${key} text`);
  }
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("草稿已儲存");
  await page.reload();
  await expect(page.getByLabel("會議名稱", { exact: true })).toHaveValue(
    "Synthetic Academic Forum",
  );
  const concurrent = await page.context().newPage();
  await concurrent.goto("/admin/site");
  await expect(concurrent.getByTestId("draft-version")).toHaveText("1");
  await page.getByLabel("簡稱／副標題").fill("Research together");
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page.getByTestId("draft-version")).toHaveText("2");
  await concurrent
    .getByLabel("會議名稱", { exact: true })
    .fill("Unsent conflict content");
  await concurrent
    .getByRole("button", { name: "儲存草稿", exact: true })
    .click();
  await expect(concurrent.getByRole("alert")).toContainText("版本衝突");
  await expect(concurrent.getByLabel("會議名稱", { exact: true })).toHaveValue(
    "Unsent conflict content",
  );
  await concurrent.close();
  expect(
    (await (await page.request.get("/api/site")).json()).document,
  ).toBeNull();
  await page.getByRole("button", { name: "預覽與發布", exact: true }).click();
  await page
    .getByRole("button", { name: "預覽已儲存草稿", exact: true })
    .click();
  await expect(page.getByText("未發布預覽 · 草稿版本 2")).toBeVisible();
  await expect(page.locator(".public-site")).toContainText("Public home text");
  await page.screenshot({
    path: "test-results/phase1-3-admin.png",
    fullPage: true,
  });
  await page.getByLabel("確認發布整站草稿版本", { exact: false }).check();
  await page.getByRole("button", { name: "確認發布", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("發布完成");
  const visitorContext = await browser.newContext({
    baseURL: process.env.PUBLIC_APP_ORIGIN!,
    javaScriptEnabled: false,
    timezoneId: "America/Los_Angeles",
  });
  const visitor = await visitorContext.newPage();
  const response = await visitor.goto("/");
  expect(response?.headers()["cache-control"]).toBe("no-store");
  await expect(
    visitor.getByRole("heading", {
      name: "Synthetic Academic Forum",
      exact: true,
    }),
  ).toBeVisible();
  await expect(visitor.getByText("2027-02-28", { exact: true })).toBeVisible();
  await expect(visitor.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    `${process.env.PUBLIC_APP_ORIGIN}/zh-Hant/home`,
  );
  await visitor.getByRole("link", { name: "關於會議", exact: true }).click();
  await expect(
    visitor.getByText("Public about text", { exact: true }),
  ).toBeVisible();
  await visitor.screenshot({
    path: "test-results/phase1-3-public-desktop.png",
    fullPage: true,
  });
  await visitor.setViewportSize({ width: 390, height: 844 });
  await visitor.screenshot({
    path: "test-results/phase1-3-public-mobile.png",
    fullPage: true,
  });
  expect((await visitor.goto("/en/home"))?.status()).toBe(404);
  expect((await visitor.goto("/missing"))?.status()).toBe(404);
  expect(
    (await visitor.request.get("/api/site/preview?version=2")).status(),
  ).toBe(401);
  await page.getByRole("button", { name: "基本資訊", exact: true }).click();
  await page
    .getByLabel("會議名稱", { exact: true })
    .fill("Secret future title");
  await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
  await expect(page.getByTestId("draft-version")).toHaveText("3");
  await visitor.goto("/");
  await expect(visitor.locator("body")).not.toContainText(
    "Secret future title",
  );
  expect(
    (await (await page.request.get("/api/instance")).json()).conferenceName,
  ).toBe("Synthetic Academic Forum");
  await page.getByRole("button", { name: "預覽與發布", exact: true }).click();
  await page.getByLabel("確認發布整站草稿版本", { exact: false }).check();
  await page.getByRole("button", { name: "確認發布", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("發布完成");
  await visitor.reload();
  await expect(
    visitor.getByRole("heading", { name: "Secret future title", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "發布歷程", exact: true }).click();
  await page
    .getByRole("button", { name: "載入此版本為新草稿", exact: true })
    .last()
    .click();
  await page
    .getByRole("button", { name: "確認載入歷史為新草稿", exact: true })
    .click();
  await expect(page.getByTestId("draft-version")).toHaveText("4");
  await visitor.reload();
  await expect(
    visitor.getByRole("heading", { name: "Secret future title", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "基本資訊", exact: true }).click();
  await expect(page.getByLabel("會議名稱", { exact: true })).toHaveValue(
    "Synthetic Academic Forum",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/phase1-3-admin-mobile.png",
    fullPage: true,
  });
  await visitorContext.close();
});
test("expired session clears draft/history and rejects late private response; ordinary direct URL denies", async ({
  page,
}) => {
  await login(page, email);
  await page.goto("/admin/site");
  await expect(page.getByLabel("會議名稱", { exact: true })).toBeVisible();
  let release!: () => void, started!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (started = r));
  await page.route("**/api/site/draft", async (route) => {
    const response = await route.fetch();
    started();
    await gate;
    try {
      await route.fulfill({ response });
    } catch (e) {
      expect(String(e)).toMatch(/Target|closed|already handled/);
    }
  });
  await page
    .getByRole("button", { name: "重試／取得伺服器版本", exact: true })
    .click();
  await ready;
  const csrf = await (await page.request.get("/api/auth/csrf")).json();
  expect(
    (
      await page.request.post("/api/auth/logout", {
        data: {},
        headers: {
          origin: process.env.PUBLIC_APP_ORIGIN!,
          "x-csrf-token": csrf.csrfToken,
        },
      })
    ).status(),
  ).toBe(200);
  await page
    .getByRole("button", { name: "重試／取得伺服器版本", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Session 已被撤銷");
  release();
  await page.unroute("**/api/site/draft");
  await expect(page.getByLabel("會議名稱", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("Synthetic Academic Forum", { exact: true }),
  ).toHaveCount(0);
  const ordinary = f.email();
  await register(page, ordinary);
  await login(page, ordinary);
  await page.goto("/admin/site");
  await expect(page.getByRole("alert")).toContainText("沒有官網管理權限");
  expect((await page.request.get("/api/site/preview?version=4")).status()).toBe(
    403,
  );
});

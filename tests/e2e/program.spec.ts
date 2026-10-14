import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { authFixture, password } from "../helpers/auth.js";
import { register, login } from "../helpers/browser-account.js";
const f = authFixture();
let baseline: { version: number; active_publication_id: string | null },
  adminId: string;
const resources: string[] = [];
test.beforeAll(async () => {
  baseline = (await f.admin.query("SELECT * FROM confsys.program_state"))
    .rows[0];
});
test.afterAll(async () => {
  await f.admin.query(
    "UPDATE confsys.program_state SET version=$1,active_publication_id=$2",
    [baseline.version, baseline.active_publication_id],
  );
  if (adminId)
    await f.admin.query(
      "DELETE FROM confsys.program_publications WHERE published_by=$1",
      [adminId],
    );
  for (const table of [
    "program_person_bookings",
    "program_slots",
    "program_sessions",
    "program_room_bookings",
    "program_rooms",
  ])
    await f.admin.query(
      `DELETE FROM confsys.${table} WHERE ${table === "program_person_bookings" ? "source_id" : "id"}=ANY($1::uuid[])`,
      [resources],
    );
  await f.cleanup();
});
test("administrator schedules a session and lecture; published program is searchable and isolated from draft changes", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const email = f.email();
  await register(page, email);
  await login(page, email);
  adminId = (await (await page.request.get("/api/auth/me")).json()).user.id;
  execFileSync(
    process.execPath,
    [
      "--conditions=development",
      "--import",
      "tsx",
      "scripts/bootstrap-admin.ts",
      "--user-id",
      adminId,
      "--apply",
      "--reason",
      "Synthetic program E2E",
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
  await page.goto("/admin/program");
  await page.getByRole("button", { name: "新增會場", exact: true }).click();
  await page.getByLabel("場館", { exact: true }).fill("Synthetic venue");
  await page.getByLabel("會場名稱").fill("Synthetic hall");
  await page.getByRole("button", { name: "儲存會場" }).click();
  await expect(page.getByRole("status")).toContainText("議程草稿已儲存");
  const room = (
    await (await page.request.get("/api/program/draft")).json()
  ).rooms.find((r: { name: string }) => r.name === "Synthetic hall");
  resources.push(room.id);
  await page.getByRole("button", { name: "新增 Session", exact: true }).click();
  const sessionGroup = page.getByRole("group", {
    name: "Session 與主持人",
    exact: true,
  });
  await sessionGroup
    .getByLabel("Session 名稱", { exact: true })
    .fill("Synthetic scientific session");
  await sessionGroup
    .getByLabel("Session 會場", { exact: true })
    .selectOption(room.id);
  await sessionGroup
    .getByLabel("開始 UTC ISO", { exact: true })
    .fill("2030-01-01T01:00:00Z");
  await sessionGroup
    .getByLabel("結束 UTC ISO", { exact: true })
    .fill("2030-01-01T02:00:00Z");
  await sessionGroup.getByLabel("主持人姓名").fill("Synthetic chair");
  await sessionGroup
    .getByLabel("主持人 Email（僅供私有衝突檢查）")
    .fill("chair@example.invalid");
  await sessionGroup
    .getByRole("button", { name: "儲存 Session", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("議程草稿已儲存");
  const session = (
    await (await page.request.get("/api/program/draft")).json()
  ).sessions.find(
    (s: { title: string }) => s.title === "Synthetic scientific session",
  );
  resources.push(session.id);
  await page.getByRole("button", { name: "新增發表", exact: true }).click();
  const slots = page.getByRole("group", { name: "發表時段", exact: true });
  await slots
    .getByLabel("所屬 Session", { exact: true })
    .selectOption(session.id);
  await slots.getByLabel("發表類型", { exact: true }).selectOption("invited");
  await slots
    .getByLabel("開始 UTC ISO", { exact: true })
    .fill("2030-01-01T01:05:00Z");
  await slots
    .getByLabel("結束 UTC ISO", { exact: true })
    .fill("2030-01-01T01:30:00Z");
  await slots.getByLabel("演講題目").fill("Synthetic keynote");
  await slots.getByLabel("邀請講者姓名").fill("Synthetic speaker");
  await slots.getByLabel("邀請講者單位").fill("Synthetic institute");
  await slots
    .getByLabel("邀請講者 Email（私有）")
    .fill("speaker@example.invalid");
  await slots.getByRole("button", { name: "儲存發表", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("議程草稿已儲存");
  const slot = (
    await (await page.request.get("/api/program/draft")).json()
  ).slots.find((s: { title: string }) => s.title === "Synthetic keynote");
  resources.push(slot.id);
  const visitor = await browser.newContext({
      baseURL: process.env.PUBLIC_APP_ORIGIN!,
    }),
    publicPage = await visitor.newPage();
  await publicPage.goto("/program");
  await expect(
    publicPage.getByText("Synthetic keynote", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("重新驗證密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "重新驗證", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("密碼已重新驗證");
  await page.getByLabel("確認發布目前完整議程草稿").check();
  await page.getByRole("button", { name: "發布議程", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("議程已發布");
  await publicPage.reload();
  await expect(
    publicPage.getByText("Synthetic keynote", { exact: true }),
  ).toBeVisible();
  await expect(publicPage.getByText("speaker@example.invalid")).toHaveCount(0);
  await expect(publicPage.getByText("chair@example.invalid")).toHaveCount(0);
  await publicPage.getByLabel("搜尋題目或發表者").fill("unmatched");
  await expect(
    publicPage.getByText("Synthetic keynote", { exact: true }),
  ).toHaveCount(0);
  await publicPage.getByLabel("搜尋題目或發表者").fill("Synthetic speaker");
  await expect(
    publicPage.getByText("Synthetic keynote", { exact: true }),
  ).toBeVisible();
  await slots.getByLabel("演講題目").fill("Draft replacement title");
  await slots.getByRole("button", { name: "儲存發表", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("議程草稿已儲存");
  await publicPage.reload();
  await expect(
    publicPage.getByText("Synthetic keynote", { exact: true }),
  ).toBeVisible();
  await expect(
    publicPage.getByText("Draft replacement title", { exact: true }),
  ).toHaveCount(0);
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.screenshot({
    path: "test-results/phase5-public-program-mobile.png",
    fullPage: true,
  });
  await visitor.close();
});

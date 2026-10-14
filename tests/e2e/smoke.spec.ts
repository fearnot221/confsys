import { test, expect } from "@playwright/test";
test("real Web/API/worker readiness, language switch and refresh", async ({
  page,
  request,
}) => {
  const response = await request.get("/api/health/ready");
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({
    status: "ready",
    dependencies: { postgres: "up", redis: "up", worker: "up" },
  });
  await page.goto("/system/status");
  await expect(
    page.getByRole("heading", { name: "系統服務狀態" }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toHaveText("所有基礎服務已就緒");
  await page.getByRole("button", { name: "重新檢查" }).click();
  await expect(page.getByRole("status")).toHaveText("所有基礎服務已就緒");
  await page.getByRole("button", { name: "Switch to English" }).click();
  await expect(
    page.getByRole("heading", { name: "System status" }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "test-results/phase0-mobile.png",
    fullPage: true,
  });
});
test("network error is visible and manual retry recovers", async ({ page }) => {
  await page.route("**/api/health/ready", (route) => route.abort());
  await page.goto("/system/status");
  await expect(page.getByRole("status")).toContainText("無法取得服務狀態");
  await page.unroute("**/api/health/ready");
  await page.getByRole("button", { name: "重新檢查" }).click();
  await expect(page.getByRole("status")).toHaveText("所有基礎服務已就緒");
  await page.screenshot({
    path: "test-results/phase0-desktop.png",
    fullPage: true,
  });
});

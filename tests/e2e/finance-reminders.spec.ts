import { test, expect, type Page } from "../helpers/browser-test.js";
import { randomUUID } from "node:crypto";
import { register, login } from "../helpers/browser-account.js";
import { authFixture } from "../helpers/auth.js";
const f = authFixture(),
  users: string[] = [];
let previous: number | null | undefined;
async function account(page: Page, email: string, role?: string) {
  await register(page, email);
  await login(page, email);
  const id = (await (await page.request.get("/api/auth/me")).json()).user
    .id as string;
  users.push(id);
  if (role)
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,$2)",
      [id, role],
    );
  return id;
}
async function post(page: Page, path: string, data: unknown) {
  const { csrfToken } = await (await page.request.get("/api/auth/csrf")).json();
  const response = await page.request.post(path, {
    data,
    headers: { origin: f.config.PUBLIC_APP_ORIGIN, "x-csrf-token": csrfToken },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
test.afterAll(async () => {
  await f.admin.query(
    "DELETE FROM confsys.notifications WHERE batch_id IN(SELECT id FROM confsys.notification_batches WHERE created_by=ANY($1::uuid[]))",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.notification_batches WHERE created_by=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.order_items WHERE order_id IN(SELECT id FROM confsys.orders WHERE user_id=ANY($1::uuid[]))",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.orders WHERE user_id=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.registrations WHERE user_id=ANY($1::uuid[])",
    [users],
  );
  if (previous !== undefined)
    await f.admin.query("UPDATE confsys.registration_state SET version=$1", [
      previous,
    ]);
  await f.admin.query(
    "DELETE FROM confsys.registration_config_versions WHERE created_by=ANY($1::uuid[])",
    [users],
  );
  await f.cleanup();
});
test("unpaid browser registration appears in finance reminder preview and explicit batch reaches real Mailpit and inbox", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const adminContext = await browser.newContext(),
    financeContext = await browser.newContext();
  try {
    const admin = await adminContext.newPage(),
      officer = await financeContext.newPage(),
      participantEmail = f.email(),
      financeEmail = f.email();
    await account(admin, f.email(), "conference_admin");
    await account(officer, financeEmail, "finance");
    await account(page, participantEmail);
    const current = await (
      await admin.request.get("/api/registration/config")
    ).json();
    previous = current.version || null;
    const ticket = randomUUID(),
      start = new Date(Date.now() - 3600000).toISOString(),
      end = new Date(Date.now() + 86400000).toISOString();
    await post(admin, "/api/registration/config", {
      expectedVersion: current.version,
      document: {
        opensAt: start,
        closesAt: end,
        currency: "TWD",
        timezone: "Asia/Taipei",
        consent: "同意催繳流程合成報名條款",
        fields: [],
        tickets: [
          ...(current.document?.tickets ?? []),
          {
            id: ticket,
            name: "合成催繳票",
            capacity: 10,
            waitlist: false,
            rates: [{ startsAt: start, endsAt: end, amount: "100" }],
          },
        ],
      },
    });
    await page.goto("/registration");
    await page.getByRole("combobox", { name: /票種/ }).selectOption(ticket);
    await page.getByLabel("名牌姓名", { exact: true }).fill("合成催繳參與者");
    await page.getByLabel("單位", { exact: true }).fill("合成大學");
    await page.getByLabel("同意催繳流程合成報名條款", { exact: true }).check();
    const saved = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/registration/create") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "確認送出報名", exact: true })
      .click();
    expect((await saved).ok()).toBe(true);
    const own = (
      await (await page.request.get("/api/registration/mine")).json()
    ).items[0];
    expect(own.order.amount).toBe("100");
    expect(own.order.paid).toBe("0");
    await officer.goto("/finance/reminders");
    await expect(
      officer.getByRole("heading", { name: "付款催繳通知", exact: true }),
    ).toBeVisible();
    const selection = officer.getByRole("checkbox", {
      name: `${participantEmail} — TWD 100`,
      exact: true,
    });
    for (let i = 0; i < 20 && (await selection.count()) === 0; i++) {
      const next = officer.getByRole("button", {
        name: "收件者下一頁",
        exact: true,
      });
      await expect(next).toBeEnabled();
      await next.click();
      await expect(
        officer.getByRole("status").filter({ hasText: "載入中" }),
      ).toHaveCount(0);
    }
    await selection.check();
    await officer
      .getByLabel("操作理由（建立及取消皆記錄）", { exact: true })
      .fill("合成財務催繳確認");
    const queued = officer.waitForResponse(
      (r) =>
        r.url().endsWith("/api/finance/reminders") &&
        r.request().method() === "POST",
    );
    await officer
      .getByRole("button", { name: "確認排入 1 位收件者", exact: true })
      .click();
    const response = await queued;
    expect(response.ok(), await response.text()).toBe(true);
    const batch = await response.json();
    expect(batch.kind).toBe("payment_reminder");
    expect(batch.recipientCount).toBe(1);
    await expect(officer.getByRole("status")).toContainText(
      "通知批次已排入工作佇列",
    );
    await expect
      .poll(
        async () => {
          const result = await fetch(
            `${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${participantEmail}`)}`,
          ).then((r) => r.json());
          return result.messages.some((m: { Subject: string }) =>
            m.Subject.includes("Payment status reminder"),
          );
        },
        { timeout: 15000 },
      )
      .toBe(true);
    await officer
      .getByRole("button", { name: "重新整理", exact: true })
      .click();
    await expect(
      officer.getByText("accepted: 1", { exact: true }),
    ).toBeVisible();
    await page.goto("/notifications");
    await expect(
      page.getByRole("heading", {
        name: "付款狀態提醒 / Payment status reminder",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText(/本研討會仍有未繳足的訂單/)).toBeVisible();
  } finally {
    await adminContext.close();
    await financeContext.close();
  }
});

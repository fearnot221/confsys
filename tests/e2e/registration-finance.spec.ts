import { test, expect, type Page } from "../helpers/browser-test.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { authFixture } from "../helpers/auth.js";
import { register, login } from "../helpers/browser-account.js";
const f = authFixture(),
  ticketId = randomUUID();
let priorVersion: number | null | undefined;
const users: string[] = [];
async function post(page: Page, url: string, data: unknown) {
  const { csrfToken } = await (await page.request.get("/api/auth/csrf")).json();
  const response = await page.request.post(url, {
    data,
    headers: { "x-csrf-token": csrfToken, origin: f.config.PUBLIC_APP_ORIGIN },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function mine(page: Page) {
  return (await (await page.request.get("/api/registration/mine")).json())
    .items[0];
}
async function finance(page: Page) {
  return await (
    await page.request.get("/api/finance/dashboard?scope=own&offset=0")
  ).json();
}
async function account(page: Page, email: string) {
  await register(page, email);
  await login(page, email);
  const user = (await (await page.request.get("/api/auth/me")).json()).user;
  users.push(user.id);
  return user.id;
}
async function recorded(page: Page) {
  await expect(page.getByRole("status")).toContainText("已記錄成功");
}
test.afterAll(async () => {
  // Remove only this flow's synthetic rows, preserving the original configuration pointer.
  const orders = "SELECT id FROM confsys.orders WHERE user_id=ANY($1::uuid[])";
  const receipts = `SELECT id FROM confsys.receipts WHERE order_id IN(${orders})`;
  await f.admin.query(
    `DELETE FROM confsys.receipt_voids WHERE receipt_id IN(${receipts})`,
    [users],
  );
  await f.admin.query(
    `DELETE FROM confsys.receipt_revisions WHERE receipt_id IN(${receipts})`,
    [users],
  );
  await f.admin.query(
    `DELETE FROM confsys.receipts WHERE order_id IN(${orders})`,
    [users],
  );
  await f.admin.query(
    `DELETE FROM confsys.refunds WHERE allocation_id IN(SELECT id FROM confsys.payment_allocations WHERE order_id IN(${orders}))`,
    [users],
  );
  await f.admin.query(
    `DELETE FROM confsys.payment_allocations WHERE order_id IN(${orders})`,
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.payments WHERE payer_id=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query(
    `DELETE FROM confsys.order_payers WHERE order_id IN(${orders})`,
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.activity_bookings WHERE user_id=ANY($1::uuid[])",
    [users],
  );
  await f.admin.query(
    `DELETE FROM confsys.order_items WHERE order_id IN(${orders})`,
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
  await f.admin.query(
    "DELETE FROM confsys.activities WHERE id IN(SELECT id FROM confsys.activity_versions WHERE created_by=ANY($1::uuid[]))",
    [users],
  );
  await f.admin.query(
    "DELETE FROM confsys.activity_versions WHERE created_by=ANY($1::uuid[])",
    [users],
  );
  if (priorVersion !== undefined)
    await f.admin.query("UPDATE confsys.registration_state SET version=$1", [
      priorVersion,
    ]);
  await f.admin.query(
    "DELETE FROM confsys.registration_config_versions WHERE created_by=ANY($1::uuid[])",
    [users],
  );
  await f.cleanup();
});
test("conditional registration and price snapshots -> group reconciliation -> receipt PDF -> activity cancellation and explicit refund", async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  const adminContext = await browser.newContext(),
    secondContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    second = await secondContext.newPage();
  try {
    const payerEmail = f.email(),
      secondEmail = f.email();
    const adminId = await account(admin, f.email());
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin'),($1,'finance')",
      [adminId],
    );
    await account(page, payerEmail);
    await account(second, secondEmail);
    priorVersion = (
      await f.admin.query("SELECT version FROM confsys.registration_state")
    ).rows[0].version;
    const startsAt = new Date(Date.now() - 3600000).toISOString(),
      endsAt = new Date(Date.now() + 86400000).toISOString();
    const document = {
      opensAt: startsAt,
      closesAt: endsAt,
      currency: "TWD",
      timezone: "Asia/Taipei",
      consent: "同意合成測試報名條款",
      fields: [
        {
          key: "needs_letter",
          label: "需要邀請函",
          type: "checkbox",
          required: false,
          options: [],
        },
        {
          key: "letter_name",
          label: "邀請函抬頭",
          type: "text",
          required: true,
          options: [],
          showWhen: { fieldKey: "needs_letter", equals: true },
        },
      ],
      tickets: [
        {
          id: ticketId,
          name: "合成一般票",
          capacity: 10,
          waitlist: false,
          rates: [{ startsAt, endsAt, amount: "100" }],
        },
      ],
    };
    const configured = await post(admin, "/api/registration/config", {
      expectedVersion: priorVersion ?? 0,
      document,
    });
    await page.goto("/registration");
    await expect(page.getByLabel("邀請函抬頭", { exact: false })).toHaveCount(
      0,
    );
    await page.getByLabel("需要邀請函", { exact: true }).check();
    await page.getByLabel("邀請函抬頭", { exact: false }).fill("合成研究所");
    await page.getByLabel("名牌姓名", { exact: true }).fill("合成甲");
    await page.getByLabel("單位", { exact: true }).fill("合成大學");
    await page.getByLabel("同意合成測試報名條款", { exact: true }).check();
    const registered = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/registration/create") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "確認送出報名", exact: true })
      .click();
    expect((await registered).ok()).toBe(true);
    const first = await mine(page);
    expect(first.answers).toEqual({
      needs_letter: true,
      letter_name: "合成研究所",
    });
    expect(first.order.amount).toBe("100");
    // A later form/rate version must never reprice a previously created order.
    document.tickets[0]!.rates[0]!.amount = "200";
    await post(admin, "/api/registration/config", {
      expectedVersion: configured.version,
      document,
    });
    await second.goto("/registration");
    await second.getByLabel("名牌姓名", { exact: true }).fill("合成乙");
    await second.getByLabel("同意合成測試報名條款", { exact: true }).check();
    const secondRegistered = second.waitForResponse(
      (r) =>
        r.url().endsWith("/api/registration/create") &&
        r.request().method() === "POST",
    );
    await second
      .getByRole("button", { name: "確認送出報名", exact: true })
      .click();
    expect((await secondRegistered).ok()).toBe(true);
    const other = await mine(second);
    expect(other.order.amount).toBe("200");
    expect((await mine(page)).order.amount).toBe("100");
    expect(other.answers).not.toHaveProperty("letter_name");
    await second.goto("/finance");
    await second
      .getByLabel("授權團體付款人信箱", { exact: true })
      .fill(payerEmail);
    await second
      .getByRole("button", { name: "確認付款人授權", exact: true })
      .click();
    await recorded(second);
    await page.goto("/finance");
    await expect(
      page.getByRole("heading", { name: new RegExp("合成乙") }),
    ).toBeVisible();
    await page.getByLabel("金額（最小貨幣單位）", { exact: true }).fill("300");
    await page.getByLabel("幣別", { exact: true }).fill("TWD");
    const reference = `synthetic-${randomUUID()}`;
    await page.getByLabel("銀行匯款參考編號", { exact: true }).fill(reference);
    await page.getByRole("button", { name: "提交待核帳", exact: true }).click();
    await recorded(page);
    const payment = (await finance(page)).payments.find(
      (p: { reference: string }) => p.reference === reference,
    );
    expect(payment.state).toBe("submitted");
    await admin.goto("/admin/finance");
    const paymentArticle = admin.locator("article").filter({
      has: admin.getByRole("heading", { name: reference, exact: true }),
    });
    await paymentArticle
      .getByLabel("核帳理由", { exact: true })
      .fill("合成銀行對帳紀錄確認");
    await paymentArticle
      .getByRole("button", { name: "確認核帳", exact: true })
      .click();
    await recorded(admin);
    await expect(paymentArticle).toContainText("verified");
    const allocationForm = admin.locator("form").filter({
      has: admin.getByRole("heading", {
        name: "分配已核帳款項",
        exact: true,
      }),
    });
    for (const [index, order] of [first.order, other.order].entries()) {
      if (index)
        await allocationForm
          .getByRole("button", { name: "開始另一筆分配", exact: true })
          .click();
      await allocationForm
        .locator("select[name=paymentId]")
        .selectOption(payment.id);
      await allocationForm
        .locator("select[name=orderId]")
        .selectOption(order.id);
      await allocationForm
        .getByLabel("分配金額", { exact: true })
        .fill(order.amount);
      await allocationForm
        .getByLabel("理由", { exact: true })
        .fill("已取得團體付款授權");
      await allocationForm
        .getByRole("button", { name: "確認分配", exact: true })
        .click();
      await recorded(admin);
    }
    expect((await mine(page)).order.paid).toBe("100");
    expect((await mine(second)).order.paid).toBe("200");
    await admin.goto("/admin/receipts");
    await admin
      .getByLabel("已全額核帳的訂單 ID", { exact: true })
      .fill(first.order.id);
    await admin.getByLabel("收據抬頭", { exact: true }).fill("合成研究所");
    await admin
      .getByLabel("操作理由", { exact: true })
      .fill("已全額核帳發行合成收據");
    await admin.getByRole("button", { name: "確認發行", exact: true }).click();
    await expect(admin.getByRole("status")).toContainText("已更新");
    await page.goto("/receipts");
    const downloadPromise = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下載／重印 PDF", exact: true })
      .click();
    const download = await downloadPromise,
      path = await download.path();
    expect(path).not.toBeNull();
    expect((await readFile(path!)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(download.suggestedFilename()).toMatch(/^receipt-.*-v1\.pdf$/);
    const originalReceipt = (
      await (await page.request.get("/api/receipts/mine?offset=0")).json()
    ).items[0];
    await admin
      .getByRole("button", { name: "更正／作廢", exact: true })
      .click();
    await admin
      .getByLabel("操作理由", { exact: true })
      .fill("合成流程先作廢再重開");
    await admin
      .getByRole("button", { name: "確認作廢此收據", exact: true })
      .click();
    await expect(
      admin.getByRole("button", {
        name: "以新號碼重開已作廢收據",
        exact: true,
      }),
    ).toBeVisible();
    await admin.getByLabel("收據抬頭", { exact: true }).fill("合成重開研究所");
    await admin
      .getByLabel("操作理由", { exact: true })
      .fill("合成收據關聯重開理由");
    await admin
      .getByRole("button", { name: "以新號碼重開已作廢收據", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await (await page.request.get("/api/receipts/mine?offset=0")).json())
            .items.length,
      )
      .toBe(2);
    await page.reload();
    const replacementReceipt = (
      await (await page.request.get("/api/receipts/mine?offset=0")).json()
    ).items.find((item: { state: string }) => item.state === "issued");
    expect(replacementReceipt.reissuedFrom.id).toBe(originalReceipt.id);
    const sourceDetail = page.waitForResponse((response) =>
      response.url().includes(`/api/receipts/detail?id=${originalReceipt.id}`),
    );
    await page
      .getByRole("button", {
        name: originalReceipt.snapshot.number,
        exact: true,
      })
      .click();
    expect((await sourceDetail).status()).toBe(200);
    await expect(
      page.getByText("合成收據關聯重開理由", { exact: false }),
    ).toBeVisible();
    const successorDetail = page.waitForResponse((response) =>
      response
        .url()
        .includes(`/api/receipts/detail?id=${replacementReceipt.id}`),
    );
    await page
      .getByRole("button", {
        name: replacementReceipt.snapshot.number,
        exact: true,
      })
      .click();
    expect((await successorDetail).status()).toBe(200);
    await admin.goto("/admin/activities");
    const editor = admin.getByRole("group", { name: "新增活動", exact: true });
    for (const [label, value] of [
      ["活動名稱", "合成午餐瀏覽器流程"],
      ["開始時間", new Date(Date.now() + 7200000).toISOString()],
      ["結束時間", new Date(Date.now() + 10800000).toISOString()],
      ["預訂截止", new Date(Date.now() + 3600000).toISOString()],
      ["每份最小單位金額", "20"],
      ["幣別", "TWD"],
      ["名額", "5"],
      ["變更理由", "合成餐飲流程設定"],
    ])
      await editor.getByLabel(label!, { exact: true }).fill(value!);
    await editor
      .getByLabel("餐別（每行一個；非餐飲可留白）", { exact: true })
      .fill("素食\n一般");
    await editor
      .getByRole("button", { name: "儲存活動版本", exact: true })
      .click();
    await expect(
      admin.getByRole("heading", { name: "合成午餐瀏覽器流程", exact: true }),
    ).toBeVisible();
    await page.goto("/activities");
    const meal = page.locator("article").filter({
      has: page.getByRole("heading", {
        level: 2,
        name: "合成午餐瀏覽器流程",
        exact: true,
      }),
    });
    await meal.locator("select[name=mealType]").selectOption("素食");
    await meal
      .getByRole("button", { name: "確認預訂並建立訂單", exact: true })
      .click();
    const booking = page.locator("article").filter({
      has: page.getByRole("heading", {
        level: 3,
        name: "合成午餐瀏覽器流程",
        exact: true,
      }),
    });
    await expect(booking).toContainText("1 份 · 素食 · reserved");
    await page.getByLabel("取消理由", { exact: true }).fill("合成測試取消餐飲");
    await booking
      .getByRole("button", { name: "確認取消預訂", exact: true })
      .click();
    await expect(booking).toContainText("cancelled");
    await page.goto("/registration");
    await page.getByLabel("取消理由", { exact: true }).fill("合成測試取消報名");
    await page
      .getByRole("button", { name: "確認取消此報名", exact: true })
      .click();
    await expect.poll(async () => (await mine(page)).state).toBe("cancelled");
    expect((await mine(page)).order.refunded).toBe("0");
    const allocation = (await finance(page)).allocations.find(
      (a: { orderId: string }) => a.orderId === first.order.id,
    );
    await admin.goto("/admin/finance");
    const refundForm = admin.locator("form").filter({
      has: admin.getByRole("heading", {
        name: "記錄已執行退款",
        exact: true,
      }),
    });
    await refundForm
      .locator("select[name=allocationId]")
      .selectOption(allocation.id);
    await refundForm.getByLabel("退款金額", { exact: true }).fill("100");
    await refundForm
      .getByLabel("銀行退款參考編號", { exact: true })
      .fill(`synthetic-refund-${randomUUID()}`);
    await refundForm
      .getByLabel("退款理由", { exact: true })
      .fill("合成銀行退款紀錄已確認");
    await refundForm
      .getByRole("button", { name: "確認記錄退款", exact: true })
      .click();
    await recorded(admin);
    const cancelled = await mine(page);
    expect(cancelled.order).toMatchObject({
      state: "cancelled",
      amount: "100",
      paid: "100",
      refunded: "100",
    });
    expect(
      (await finance(page)).payments.find(
        (p: { id: string }) => p.id === payment.id,
      ),
    ).toMatchObject({ state: "verified", allocated: "300", refunded: "100" });
    expect((await mine(second)).order).toMatchObject({
      state: "open",
      paid: "200",
      refunded: "0",
    });
  } finally {
    await adminContext.close();
    await secondContext.close();
  }
});

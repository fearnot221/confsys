import { test, expect, type Page } from "../helpers/browser-test.js";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { authFixture, password } from "../helpers/auth.js";
import { register, login } from "../helpers/browser-account.js";
const f = authFixture(),
  rid = () => randomUUID(),
  users: string[] = [],
  programIds: string[] = [],
  competitionId = rid(),
  activityId = rid();
let registrationBaseline: number | null,
  submissionBaseline: { version: number; document: unknown },
  programBaseline: { version: number; active_publication_id: string | null };
test.beforeAll(async () => {
  registrationBaseline = (
    await f.admin.query("SELECT version FROM confsys.registration_state")
  ).rows[0].version;
  submissionBaseline = (
    await f.admin.query(
      "SELECT version,document FROM confsys.submission_config",
    )
  ).rows[0];
  programBaseline = (
    await f.admin.query(
      "SELECT version,active_publication_id FROM confsys.program_state",
    )
  ).rows[0];
});
async function account(page: Page, email: string, roles: string[] = []) {
  await register(page, email);
  await login(page, email);
  const id = (await (await page.request.get("/api/auth/me")).json()).user
    .id as string;
  users.push(id);
  for (const role of roles)
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,$2)",
      [id, role],
    );
  return id;
}
async function get(page: Page, path: string) {
  const response = await page.request.get(path);
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function post(page: Page, path: string, data: unknown) {
  const { csrfToken } = await get(page, "/api/auth/csrf");
  const response = await page.request.post(path, {
    data,
    headers: { origin: f.config.PUBLIC_APP_ORIGIN, "x-csrf-token": csrfToken },
  });
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
async function status(page: Page, text: string) {
  await expect(page.getByRole("status")).toContainText(text);
}
test.afterAll(async () => {
  if (users.length) {
    const q = (sql: string) => f.admin.query(sql, [users]);
    await q(
      "DELETE FROM confsys.export_jobs WHERE requester_id=ANY($1::uuid[])",
    );
    for (const table of ["receipt_revisions", "receipt_voids"])
      await q(
        `DELETE FROM confsys.${table} WHERE receipt_id IN(SELECT id FROM confsys.receipts WHERE order_id IN(SELECT id FROM confsys.orders WHERE user_id=ANY($1::uuid[])))`,
      );
    await q(
      "DELETE FROM confsys.receipts WHERE order_id IN(SELECT id FROM confsys.orders WHERE user_id=ANY($1::uuid[]))",
    );
    for (const [table, column] of [
      ["onsite_redemptions", "actor_id"],
      ["onsite_checkins", "actor_id"],
    ] as const)
      await q(`DELETE FROM confsys.${table} WHERE ${column}=ANY($1::uuid[])`);
    await q(
      "DELETE FROM confsys.onsite_tokens WHERE registration_id IN(SELECT id FROM confsys.registrations WHERE user_id=ANY($1::uuid[]))",
    );
    await f.admin.query(
      "UPDATE confsys.competitions SET active_publication_id=NULL,current_rubric_id=NULL WHERE id=$1",
      [competitionId],
    );
    await f.admin.query(
      "DELETE FROM confsys.competition_scores WHERE assignment_id IN(SELECT id FROM confsys.competition_assignments WHERE competition_id=$1)",
      [competitionId],
    );
    for (const table of [
      "competition_publications",
      "competition_conflicts",
      "competition_assignments",
      "competition_entries",
      "competition_rubrics",
    ])
      await f.admin.query(
        `DELETE FROM confsys.${table} WHERE competition_id=$1`,
        [competitionId],
      );
    await f.admin.query("DELETE FROM confsys.competitions WHERE id=$1", [
      competitionId,
    ]);
    await f.admin.query(
      "UPDATE confsys.program_state SET version=$1,active_publication_id=$2",
      [programBaseline.version, programBaseline.active_publication_id],
    );
    await q(
      "DELETE FROM confsys.program_publication_slots WHERE publication_id IN(SELECT id FROM confsys.program_publications WHERE published_by=ANY($1::uuid[]))",
    );
    await q(
      "DELETE FROM confsys.program_publications WHERE published_by=ANY($1::uuid[])",
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
        [programIds],
      );
    const ownedPapers =
      "SELECT id FROM confsys.submissions WHERE owner_id=ANY($1::uuid[])";
    await q(
      `DELETE FROM confsys.review_publication_snapshots WHERE decision_id IN(SELECT id FROM confsys.review_decisions WHERE submission_id IN(${ownedPapers}))`,
    );
    for (const table of [
      "review_publications",
      "submission_revision_requests",
      "review_decisions",
      "review_screenings",
      "review_assignments",
      "review_conflicts",
    ])
      await q(
        `DELETE FROM confsys.${table} WHERE submission_id IN(${ownedPapers})`,
      );
    await q(
      "DELETE FROM confsys.review_chair_scopes WHERE user_id=ANY($1::uuid[])",
    );
    await q(
      "DELETE FROM confsys.review_forms WHERE created_by=ANY($1::uuid[])",
    );
    await q(
      "UPDATE confsys.submissions SET state='draft',current_revision_id=NULL,submitted_version=NULL WHERE owner_id=ANY($1::uuid[])",
    );
    await q(
      "DELETE FROM confsys.submission_revisions WHERE owner_id=ANY($1::uuid[])",
    );
    await q("DELETE FROM confsys.submissions WHERE owner_id=ANY($1::uuid[])");
    await q(
      "DELETE FROM confsys.file_references WHERE file_id IN(SELECT id FROM confsys.file_assets WHERE owner_id=ANY($1::uuid[]))",
    );
    await q("DELETE FROM confsys.file_assets WHERE owner_id=ANY($1::uuid[])");
    await q(
      "DELETE FROM confsys.activity_bookings WHERE user_id=ANY($1::uuid[])",
    );
    await f.admin.query("DELETE FROM confsys.activities WHERE id=$1", [
      activityId,
    ]);
    await f.admin.query("DELETE FROM confsys.activity_versions WHERE id=$1", [
      activityId,
    ]);
    await q(
      "DELETE FROM confsys.payment_allocations WHERE created_by=ANY($1::uuid[])",
    );
    await q("DELETE FROM confsys.payments WHERE payer_id=ANY($1::uuid[])");
    await q(
      "DELETE FROM confsys.order_items WHERE order_id IN(SELECT id FROM confsys.orders WHERE user_id=ANY($1::uuid[]))",
    );
    await q("DELETE FROM confsys.orders WHERE user_id=ANY($1::uuid[])");
    await q("DELETE FROM confsys.registrations WHERE user_id=ANY($1::uuid[])");
    await f.admin.query("UPDATE confsys.registration_state SET version=$1", [
      registrationBaseline,
    ]);
    await q(
      "DELETE FROM confsys.registration_config_versions WHERE created_by=ANY($1::uuid[])",
    );
    await f.admin.query(
      "UPDATE confsys.submission_config SET version=$1,document=$2",
      [submissionBaseline.version, submissionBaseline.document],
    );
  }
  await f.cleanup();
});

test("one participant traverses paid registration, manuscript review, public program and award, onsite and final documents in the browser", async ({
  page,
  browser,
}) => {
  test.setTimeout(240000);
  const adminContext = await browser.newContext(),
    judgeContext = await browser.newContext(),
    visitorContext = await browser.newContext();
  const admin = await adminContext.newPage(),
    judge = await judgeContext.newPage(),
    visitor = await visitorContext.newPage();
  try {
    const authorEmail = f.email(),
      adminEmail = f.email(),
      judgeEmail = f.email(),
      title = "Synthetic browser continuity study";
    const adminId = await account(admin, adminEmail, [
      "conference_admin",
      "finance",
      "chair",
    ]);
    const judgeId = await account(judge, judgeEmail, [
      "reviewer",
      "competition_judge",
    ]);
    await account(page, authorEmail);
    const past = new Date(Date.now() - 3600000).toISOString(),
      future = new Date(Date.now() + 86400000).toISOString(),
      ticket = rid();
    // Only configuration uses authenticated APIs; all business transitions below are UI actions.
    const previous = await get(admin, "/api/registration/config");
    await post(admin, "/api/registration/config", {
      expectedVersion: previous.version,
      document: {
        opensAt: past,
        closesAt: future,
        currency: "TWD",
        timezone: "Asia/Taipei",
        consent: "同意完整流程合成測試條款",
        fields: [],
        tickets: [
          ...(previous.document?.tickets ?? []),
          {
            id: ticket,
            name: "跨階段合成票",
            capacity: 10,
            waitlist: false,
            rates: [{ startsAt: past, endsAt: future, amount: "100" }],
          },
        ],
      },
    });
    await post(admin, "/api/activities/configure", {
      id: activityId,
      expectedVersion: 0,
      document: {
        name: "跨階段合成午餐",
        kind: "meal",
        startsAt: future,
        endsAt: new Date(Date.now() + 90000000).toISOString(),
        deadline: future,
        capacity: 10,
        amount: "20",
        currency: "TWD",
        mealTypes: ["素食"],
        active: true,
      },
      reason: "Synthetic lifecycle meal configuration",
    });
    await page.goto("/registration");
    await page.getByRole("combobox", { name: /票種/ }).selectOption(ticket);
    await page.getByLabel("名牌姓名", { exact: true }).fill("跨階段合成參與者");
    await page.getByLabel("單位", { exact: true }).fill("Synthetic Institute");
    await page.getByLabel("同意完整流程合成測試條款", { exact: true }).check();
    const registerResponse = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/registration/create") &&
        r.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "確認送出報名", exact: true })
      .click();
    expect((await registerResponse).ok()).toBe(true);
    const participant = (await get(page, "/api/registration/mine")).items[0];
    expect(participant.order.paid).toBe("0");
    await page.goto("/activities");
    const meal = page.locator("article").filter({
      has: page.getByRole("heading", {
        level: 2,
        name: "跨階段合成午餐",
        exact: true,
      }),
    });
    await meal.locator("select[name=mealType]").selectOption("素食");
    await meal
      .getByRole("button", { name: "確認預訂並建立訂單", exact: true })
      .click();
    await expect(
      page.locator("article").filter({
        has: page.getByRole("heading", {
          level: 3,
          name: "跨階段合成午餐",
          exact: true,
        }),
      }),
    ).toContainText("reserved");
    const booking = (await get(page, "/api/activities/mine")).items.find(
      (b: { activityId: string }) => b.activityId === activityId,
    );
    // Submitted payment remains unverified until the independent administrative UI reconciles it.
    await page.goto("/finance");
    await page.getByLabel("金額（最小貨幣單位）", { exact: true }).fill("120");
    await page.getByLabel("幣別", { exact: true }).fill("TWD");
    const reference = `browser-lifecycle-${rid()}`;
    await page.getByLabel("銀行匯款參考編號", { exact: true }).fill(reference);
    await page.getByRole("button", { name: "提交待核帳", exact: true }).click();
    await status(page, "已記錄成功");
    const payment = (
      await get(page, "/api/finance/dashboard?scope=own")
    ).payments.find((p: { reference: string }) => p.reference === reference);
    expect(payment.state).toBe("submitted");
    await admin.goto("/admin/finance");
    const paymentRow = admin.locator("article").filter({
      has: admin.getByRole("heading", { name: reference, exact: true }),
    });
    await paymentRow
      .getByLabel("核帳理由", { exact: true })
      .fill("Synthetic manual transfer verified");
    await paymentRow
      .getByRole("button", { name: "確認核帳", exact: true })
      .click();
    await status(admin, "已記錄成功");
    await expect(paymentRow).toContainText("verified");
    const allocation = admin.locator("form").filter({
      has: admin.getByRole("heading", {
        name: "分配已核帳款項",
        exact: true,
      }),
    });
    for (const [index, order] of [
      { id: participant.order.id, amount: "100" },
      { id: booking.orderId, amount: "20" },
    ].entries()) {
      if (index)
        await allocation
          .getByRole("button", { name: "開始另一筆分配", exact: true })
          .click();
      await allocation
        .locator("select[name=paymentId]")
        .selectOption(payment.id);
      await allocation.locator("select[name=orderId]").selectOption(order.id);
      await allocation
        .getByLabel("分配金額", { exact: true })
        .fill(order.amount);
      await allocation
        .getByLabel("理由", { exact: true })
        .fill("Synthetic individual settlement");
      await allocation
        .getByRole("button", { name: "確認分配", exact: true })
        .click();
      await status(admin, "已記錄成功");
    }
    expect(
      (await get(page, "/api/registration/mine")).items[0].order.paid,
    ).toBe("100");
    const subConfig = await get(admin, "/api/submissions/config");
    await post(admin, "/api/submissions/config", {
      ...subConfig,
      opensAt: past,
      closesAt: future,
      requireRegistration: true,
      requireAttachment: false,
      acceptedRegistrationDeadline: new Date(
        Date.parse(future) + 86_400_000,
      ).toISOString(),
      mode: "abstract",
      presenterMustBeSubmitter: true,
      tracks: [{ id: "continuity", name: "Continuity science", topics: [] }],
    });
    await page.goto("/submissions");
    await page.getByRole("button", { name: "建立新草稿", exact: true }).click();
    await page.getByLabel("標題", { exact: true }).fill(title);
    await page
      .getByLabel("摘要", { exact: true })
      .fill("Anonymous synthetic continuity abstract.");
    await page.getByLabel("主題軌", { exact: true }).selectOption("continuity");
    await page.getByLabel("姓名", { exact: true }).fill("跨階段合成參與者");
    await page.getByLabel("Email", { exact: true }).fill(authorEmail);
    await page.getByLabel("單位", { exact: true }).fill("Synthetic Institute");
    await page.getByLabel("此作者為通訊作者", { exact: true }).check();
    await page.getByLabel("發表意願", { exact: true }).selectOption("oral");
    await page.getByLabel("有意參加競賽", { exact: true }).check();
    await page.getByRole("button", { name: "儲存草稿", exact: true }).click();
    await status(page, "草稿已儲存");
    await page
      .getByRole("button", { name: "正式提交此版本", exact: true })
      .click();
    await page.getByRole("button", { name: "確認", exact: true }).click();
    await status(page, "正式提交成功");
    const paper = (await get(page, "/api/submissions?scope=own")).items.find(
      (p: { document: { title: string } }) => p.document.title === title,
    );
    expect(paper.currentRevisionId).toBeTruthy();
    const form = await post(admin, "/api/reviews/forms", {
      name: "Browser continuity rubric",
      mode: "double_blind",
      closesAt: future,
      requireScreening: true,
      criteria: [{ id: "quality", label: "研究品質", max: 5 }],
    });
    await post(admin, "/api/reviews/chair-scope", {
      userId: adminId,
      trackId: "continuity",
      remove: false,
    });
    await admin.goto("/reviews");
    await admin
      .getByRole("combobox", { name: "正式投稿", exact: true })
      .selectOption(paper.id);
    await admin
      .getByRole("combobox", { name: "審查委員", exact: true })
      .selectOption(judgeId);
    await admin
      .getByRole("combobox", { name: "評分表版本", exact: true })
      .selectOption(form.id);
    await admin
      .getByLabel("初檢理由（內部）", { exact: true })
      .fill("Synthetic requirements checked");
    await admin
      .getByRole("button", { name: "保存初檢新版本", exact: true })
      .click();
    await status(admin, "初檢已保存");
    await admin
      .getByLabel("已人工確認稿件內容與中繼資料符合匿名要求（雙盲必要）", {
        exact: true,
      })
      .check();
    await admin
      .getByRole("button", { name: "指派此不可變版本", exact: true })
      .click();
    await status(admin, "已指派不可變投稿版本");
    await judge.goto("/reviews");
    await expect(
      judge.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(judge.getByText(authorEmail, { exact: false })).toHaveCount(0);
    await judge.getByRole("button", { name: "接受指派", exact: true }).click();
    await status(judge, "審查狀態已更新");
    await judge.getByLabel("研究品質（0–5）").fill("4");
    await judge
      .getByLabel("給作者的評語", { exact: true })
      .fill("Lifecycle author-visible feedback");
    await judge
      .getByLabel("僅主席可見的內部評語")
      .fill("PRIVATE_LIFECYCLE_REVIEW");
    await judge
      .getByRole("button", { name: "正式送出並鎖定", exact: true })
      .click();
    await status(judge, "審查已正式送出");
    await page.goto("/reviews");
    await expect(
      page.getByText("Lifecycle author-visible feedback", { exact: true }),
    ).toHaveCount(0);
    await admin.reload();
    await admin
      .getByRole("combobox", { name: "正式投稿", exact: true })
      .selectOption(paper.id);
    await admin
      .getByRole("combobox", { name: "決議", exact: true })
      .selectOption("accept_oral");
    await admin
      .getByLabel("發布後給作者的訊息")
      .fill("Lifecycle oral acceptance");
    await admin
      .getByLabel("內部決議理由", { exact: true })
      .fill("Private justified decision");
    await admin
      .getByRole("button", { name: "儲存新決議版本", exact: true })
      .click();
    await status(admin, "決議草稿已保存");
    await page.reload();
    await expect(
      page.getByText("Lifecycle oral acceptance", { exact: true }),
    ).toHaveCount(0);
    await admin
      .getByRole("button", { name: "明確發布此結果並通知作者", exact: true })
      .click();
    await status(admin, "結果已發布");
    await page.reload();
    await expect(
      page.getByText("Lifecycle oral acceptance", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Lifecycle author-visible feedback", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("PRIVATE_LIFECYCLE_REVIEW", { exact: false }),
    ).toHaveCount(0);
    const room = rid(),
      session = rid();
    programIds.push(room, session);
    let program = await get(admin, "/api/program/draft");
    await post(admin, "/api/program/rooms", {
      expectedVersion: program.version,
      item: {
        id: room,
        name: "Continuity hall",
        venue: "Synthetic venue",
        bufferMinutes: 0,
      },
    });
    program = await get(admin, "/api/program/draft");
    await post(admin, "/api/program/sessions", {
      expectedVersion: program.version,
      item: {
        id: session,
        roomId: room,
        title: "Continuity oral session",
        startsAt: "2034-01-01T01:00:00Z",
        endsAt: "2034-01-01T02:00:00Z",
        chairName: "Synthetic chair",
        chairEmail: adminEmail,
      },
    });
    await admin.goto("/admin/program");
    await admin.getByRole("button", { name: "新增發表", exact: true }).click();
    const slots = admin.getByRole("group", { name: "發表時段", exact: true });
    await slots
      .getByLabel("所屬 Session", { exact: true })
      .selectOption(session);
    await slots.getByLabel("發表類型", { exact: true }).selectOption("oral");
    await slots
      .getByLabel("開始 UTC ISO", { exact: true })
      .fill("2034-01-01T01:05:00Z");
    await slots
      .getByLabel("結束 UTC ISO", { exact: true })
      .fill("2034-01-01T01:20:00Z");
    await slots
      .getByLabel("正式錄取的提交版本 ID", { exact: true })
      .fill(paper.currentRevisionId);
    await slots.getByRole("button", { name: "儲存發表", exact: true }).click();
    await status(admin, "議程草稿已儲存");
    const slot = (await get(admin, "/api/program/draft")).slots.find(
      (s: { revisionId: string }) => s.revisionId === paper.currentRevisionId,
    );
    programIds.push(slot.id);
    await visitor.goto("/program");
    await expect(visitor.getByText(title, { exact: true })).toHaveCount(0);
    await admin.getByLabel("確認發布目前完整議程草稿").check();
    await admin.getByRole("button", { name: "發布議程", exact: true }).click();
    await status(admin, "議程已發布");
    await visitor.reload();
    await expect(visitor.getByText(title, { exact: true })).toBeVisible();
    await expect(visitor.getByText(authorEmail, { exact: false })).toHaveCount(
      0,
    );
    const compConfig = {
      name: "Continuity oral competition",
      kind: "oral",
      registrationClosesAt: future,
      judgingClosesAt: new Date(Date.now() + 172800000).toISOString(),
      requireRegistration: true,
      minimumJudges: 1,
      tiePolicy: "shared",
      eligibilityNote: "Confirmed registered accepted oral manuscript",
      criteria: [{ id: "quality", label: "研究品質", maximum: 100, weight: 1 }],
    };
    await post(admin, "/api/competitions/configure", {
      id: competitionId,
      expectedVersion: 0,
      config: compConfig,
    });
    await page.goto("/competitions");
    await page
      .getByLabel("申請參賽競賽", { exact: true })
      .selectOption(competitionId);
    await page.getByLabel("錄取修訂版本 ID").fill(paper.currentRevisionId);
    await page.getByRole("button", { name: "提出申請", exact: true }).click();
    await status(page, "操作已完成");
    const entry = (await get(page, "/api/competitions")).entries.find(
      (e: { competitionId: string }) => e.competitionId === competitionId,
    );
    await admin.goto("/admin/competitions");
    await admin
      .getByLabel("操作理由", { exact: true })
      .fill("Eligibility checked from same accepted manuscript");
    await admin.getByRole("button", { name: "確認資格", exact: true }).click();
    await status(admin, "操作已完成");
    await admin.getByRole("button", { name: "編輯規則", exact: true }).click();
    await admin
      .getByLabel("參賽截止 UTC ISO")
      .fill(new Date(Date.now() - 1000).toISOString());
    await admin.getByRole("button", { name: "儲存規則", exact: true }).click();
    await status(admin, "操作已完成");
    await admin.getByRole("button", { name: "關閉編輯", exact: true }).click();
    await admin.getByLabel("評審帳號 ID").fill(judgeId);
    await admin.getByRole("button", { name: "指派評審", exact: true }).click();
    await status(admin, "操作已完成");
    await judge.goto("/judging");
    await expect(
      judge.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await judge.getByLabel("研究品質（滿分 100，權重 1）").fill("90");
    await judge
      .getByLabel("評語", { exact: true })
      .fill("PRIVATE_LIFECYCLE_JUDGING");
    await judge.getByLabel("確認正式評分送出後鎖定").check();
    await judge.getByRole("button", { name: "送出評分", exact: true }).click();
    await status(judge, "操作已完成");
    await expect(
      judge.getByRole("button", { name: "送出評分", exact: true }),
    ).toBeDisabled();
    await admin.reload();
    await admin
      .getByLabel("得獎名單競賽", { exact: true })
      .selectOption(competitionId);
    await admin.getByRole("button", { name: "新增獎項", exact: true }).click();
    await admin.getByLabel("參賽 ID", { exact: true }).fill(entry.id);
    await admin.getByLabel("獎項名稱").fill("Continuity oral award");
    await admin
      .getByLabel("裁定／發布理由")
      .fill("Verified final score from assigned judge");
    await admin
      .getByRole("button", { name: "儲存得獎草稿", exact: true })
      .click();
    await status(admin, "操作已完成");
    await visitor.goto("/competition-awards");
    await expect(
      visitor.getByText("第 1 名 · Continuity oral award", { exact: true }),
    ).toHaveCount(0);
    await admin.getByLabel("重新驗證密碼", { exact: true }).fill(password);
    await admin.getByRole("button", { name: "驗證", exact: true }).click();
    await status(admin, "操作已完成");
    await admin.getByLabel("確認將已儲存得獎名單公開並發送通知").check();
    await admin
      .getByRole("button", { name: "發布已儲存名單", exact: true })
      .click();
    await status(admin, "操作已完成");
    await visitor.reload();
    await expect(
      visitor.getByText("第 1 名 · Continuity oral award", { exact: true }),
    ).toBeVisible();
    await expect(
      visitor.getByText("PRIVATE_LIFECYCLE_JUDGING", { exact: false }),
    ).toHaveCount(0);
    await page.goto(`/onsite/pass?registrationId=${participant.id}`);
    await page.getByRole("button", { name: "顯示報到碼", exact: true }).click();
    await expect(
      page.getByRole("img", { name: "現場報到 QR 碼" }),
    ).toBeVisible();
    const token = await page
      .getByLabel("報到碼文字", { exact: true })
      .inputValue();
    expect(token).toMatch(/^cs1_/);
    await admin.goto("/admin/onsite");
    await admin
      .getByLabel("掃描器輸入／貼上報到碼", { exact: true })
      .fill(token);
    await admin
      .getByRole("button", { name: "查詢參與者", exact: true })
      .click();
    await expect(
      admin.getByRole("heading", { name: /跨階段合成參與者/ }),
    ).toBeVisible();
    await admin.getByRole("button", { name: "確認報到", exact: true }).click();
    await status(admin, "報到已確認");
    await admin.getByRole("button", { name: "確認核銷", exact: true }).click();
    await status(admin, "核銷已確認");
    await expect(admin.getByText(/跨階段合成午餐.*已核銷 1／1/)).toBeVisible();
    await admin.goto("/admin/receipts");
    await admin
      .getByLabel("已全額核帳的訂單 ID", { exact: true })
      .fill(participant.order.id);
    await admin
      .getByLabel("收據抬頭", { exact: true })
      .fill("Continuity Institute");
    await admin
      .getByLabel("操作理由", { exact: true })
      .fill("Issue receipt for same reconciled registration");
    await admin.getByRole("button", { name: "確認發行", exact: true }).click();
    await status(admin, "已更新");
    await page.goto("/receipts");
    const downloaded = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "下載／重印 PDF", exact: true })
      .click();
    const pdf = await downloaded,
      pdfPath = await pdf.path();
    expect(pdfPath).not.toBeNull();
    expect((await readFile(pdfPath!)).subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.suggestedFilename()).toMatch(/^receipt-.*-v1\.pdf$/);
    await admin.goto("/admin/exports");
    await admin
      .getByRole("combobox", { name: "完整匯出資料集", exact: true })
      .selectOption("registrations");
    await admin
      .getByLabel("匯出用途", { exact: true })
      .fill("Verify same participant complete browser lifecycle");
    await admin
      .getByRole("button", { name: "建立背景匯出工作", exact: true })
      .click();
    await status(admin, "匯出工作已保存");
    await expect
      .poll(
        async () => {
          await admin
            .getByRole("button", { name: "重新整理匯出狀態", exact: true })
            .click();
          return admin
            .getByRole("heading", {
              name: "registrations · 可下載",
              exact: true,
            })
            .count();
        },
        { timeout: 20000 },
      )
      .toBe(1);
    await admin.getByRole("button", { name: /驗證並取得 CSV：/ }).click();
    await expect(
      admin.getByRole("link", { name: "下載已驗證 CSV", exact: true }),
    ).toBeVisible();
    const csvPromise = admin.waitForEvent("download");
    await admin
      .getByRole("link", { name: "下載已驗證 CSV", exact: true })
      .click();
    const csvFile = await csvPromise,
      csvPath = await csvFile.path();
    expect(csvPath).not.toBeNull();
    const csv = await readFile(csvPath!, "utf8");
    expect(csv).toContain("跨階段合成參與者");
    expect(csv).toContain(authorEmail);
    expect(csv).toContain(participant.number);
    expect(csv).not.toMatch(/PRIVATE_LIFECYCLE|token_hash|password_hash/);
  } finally {
    await adminContext.close();
    await judgeContext.close();
    await visitorContext.close();
  }
});

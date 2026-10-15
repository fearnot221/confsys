import { test, expect } from "../helpers/browser-test.js";
import { register, login } from "../helpers/browser-account.js";
import { authFixture, password } from "../helpers/auth.js";
import { createAuthService } from "../../apps/api/src/auth/service.js";
import { createSubmissionService } from "../../apps/api/src/submissions/service.js";
import { submissionDependencies } from "../../apps/api/src/submissions/dependencies.js";
import { randomUUID } from "node:crypto";
const f = authFixture(),
  auth = createAuthService(f.app, f.config),
  submissions = createSubmissionService(
    f.app,
    f.config,
    submissionDependencies,
  );
let baseline: Record<string, unknown> | undefined;
test.afterAll(async () => {
  const ids = (
    await f.admin.query<{ id: string }>(
      "SELECT id FROM confsys.users WHERE email LIKE $1",
      [`${f.prefix}%`],
    )
  ).rows.map((r) => r.id);
  const papers = (
    await f.admin.query<{ id: string }>(
      "SELECT id FROM confsys.submissions WHERE owner_id=ANY($1::uuid[])",
      [ids],
    )
  ).rows.map((r) => r.id);
  await f.admin.query(
    "DELETE FROM confsys.submission_revision_requests WHERE submission_id=ANY($1::uuid[])",
    [papers],
  );
  await f.admin.query(
    "DELETE FROM confsys.review_publication_snapshots WHERE decision_id IN(SELECT id FROM confsys.review_decisions WHERE submission_id=ANY($1::uuid[]))",
    [papers],
  );
  await f.admin.query(
    "DELETE FROM confsys.review_deadline_extensions WHERE assignment_id IN(SELECT id FROM confsys.review_assignments WHERE submission_id=ANY($1::uuid[]))",
    [papers],
  );
  for (const table of [
    "review_screenings",
    "review_publications",
    "review_decisions",
    "review_conflicts",
    "review_assignments",
  ])
    await f.admin.query(
      `DELETE FROM confsys.${table} WHERE submission_id=ANY($1::uuid[])`,
      [papers],
    );
  await f.admin.query(
    "DELETE FROM confsys.review_forms WHERE created_by=ANY($1::uuid[])",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.review_chair_scopes WHERE user_id=ANY($1::uuid[])",
    [ids],
  );
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
  if (baseline)
    await f.admin.query(
      "UPDATE confsys.submission_config SET version=$1,document=$2",
      [baseline.version, baseline.document],
    );
  await f.cleanup();
});
test("real UI assigns a blind revision, reviewer submits, chair publishes and author sees only released feedback", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const adminEmail = f.email(),
    authorEmail = f.email(),
    reviewerEmail = f.email(),
    chairEmail = f.email();
  for (const email of [adminEmail, authorEmail, reviewerEmail, chairEmail])
    await register(page, email);
  const users = (
    await f.admin.query<{ id: string; email: string }>(
      "SELECT id,email FROM confsys.users WHERE email=ANY($1::text[])",
      [[adminEmail, authorEmail, reviewerEmail, chairEmail]],
    )
  ).rows;
  const id = (email: string) => {
    const value = users.find((u) => u.email === email)?.id;
    if (!value) throw new Error("Missing fixture account");
    return value;
  };
  for (const [email, role] of [
    [adminEmail, "conference_admin"],
    [reviewerEmail, "reviewer"],
    [chairEmail, "chair"],
  ])
    await f.admin.query(
      "INSERT INTO confsys.user_roles(user_id,role) VALUES ($1,$2)",
      [id(email!), role],
    );
  baseline = (await f.admin.query("SELECT * FROM confsys.submission_config"))
    .rows[0];
  const admin = (await auth.login(adminEmail, password, randomUUID())).raw,
    author = (await auth.login(authorEmail, password, randomUUID())).raw;
  const config = await submissions.config(admin);
  await submissions.configure(
    admin,
    {
      ...config,
      opensAt: "2020-01-01T00:00:00.000Z",
      closesAt: "2099-01-01T00:00:00.000Z",
      acceptedRegistrationDeadline: "2099-02-01T00:00:00.000Z",
      requireAttachment: false,
      requireRegistration: false,
      tracks: [{ id: "science", name: "Science", topics: [] }],
    },
    randomUUID(),
  );
  const draft = await submissions.save(
    author,
    {
      id: randomUUID(),
      expectedVersion: 0,
      document: {
        title: "Synthetic blind browser paper",
        abstract: "Synthetic anonymous browser abstract.",
        trackId: "science",
        topicIds: [],
        authors: [
          {
            name: "PRIVATE_BROWSER_AUTHOR",
            email: authorEmail,
            affiliation: "PRIVATE_BROWSER_AFFILIATION",
          },
        ],
        presenterIndex: 0,
        correspondingAuthorIndex: 0,
        keywords: [],
        presentationPreference: "either",
        competition: false,
        attachmentIds: [],
        slidesFileId: null,
        videoUrl: "",
      },
    },
    randomUUID(),
  );
  const paper = await submissions.transition(
    author,
    { id: draft.id, expectedVersion: draft.version, action: "submit" },
    randomUUID(),
  );
  await login(page, adminEmail);
  await page.goto("/reviews");
  await page.getByLabel("評分表名稱").fill("Synthetic E2E review");
  await page
    .getByLabel("審查截止（本機時區）")
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await page.getByLabel("指派前須通過行政初檢", { exact: true }).check();
  await page.getByRole("button", { name: "建立評分表新版本" }).click();
  await expect(page.getByRole("status")).toContainText("已建立新的評分表版本");
  await page.getByLabel("主席本地帳號 UUID").fill(id(chairEmail));
  await page.getByLabel("分組代碼").fill("science");
  await page.getByRole("button", { name: "授予分組範圍" }).click();
  await expect(page.getByRole("status")).toContainText("主席分組範圍已更新");
  await page
    .getByRole("combobox", { name: "正式投稿", exact: true })
    .selectOption(paper.id);
  await page
    .getByRole("combobox", { name: "審查委員", exact: true })
    .selectOption(id(reviewerEmail));
  const formId = (
    await f.admin.query(
      "SELECT id FROM confsys.review_forms WHERE created_by=$1 ORDER BY version DESC LIMIT 1",
      [id(adminEmail)],
    )
  ).rows[0].id;
  await page
    .getByRole("combobox", { name: "評分表版本", exact: true })
    .selectOption(formId);
  await page
    .getByLabel("初檢理由（內部）", { exact: true })
    .fill("Synthetic browser administrative screening");
  await page
    .getByRole("button", { name: "保存初檢新版本", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("初檢已保存");
  await page
    .getByLabel("已人工確認稿件內容與中繼資料符合匿名要求（雙盲必要）", {
      exact: true,
    })
    .check();
  await page.getByRole("button", { name: "指派此不可變版本" }).click();
  await expect(page.getByRole("status")).toContainText("已指派不可變投稿版本");
  const progress = page.locator("details").filter({
    has: page.locator("summary", { hasText: paper.document.title }),
  });
  await progress.locator("summary").click();
  const extendedDeadline = new Date(Date.now() + 7 * 86400000).toISOString();
  await progress
    .getByLabel("展延後截止時間（含時區）", { exact: true })
    .fill(extendedDeadline);
  await progress
    .getByLabel("展延理由（評審可見）", { exact: true })
    .fill("Synthetic browser deadline extension");
  await progress
    .getByRole("button", { name: "展延此指派期限", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("已展延期限");
  const reviewerContext = await browser.newContext({
      baseURL: process.env.PUBLIC_APP_ORIGIN!,
    }),
    chairContext = await browser.newContext({
      baseURL: process.env.PUBLIC_APP_ORIGIN!,
    }),
    authorContext = await browser.newContext({
      baseURL: process.env.PUBLIC_APP_ORIGIN!,
    });
  try {
    const reviewerPage = await reviewerContext.newPage();
    await login(reviewerPage, reviewerEmail);
    await reviewerPage.goto("/reviews");
    await expect(
      reviewerPage.getByRole("heading", { name: paper.document.title }),
    ).toBeVisible();
    await expect(
      reviewerPage.getByText("PRIVATE_BROWSER_AUTHOR", { exact: false }),
    ).toHaveCount(0);
    await reviewerPage
      .getByRole("button", { name: "接受指派", exact: true })
      .click();
    await expect(reviewerPage.getByRole("status")).toContainText(
      "審查狀態已更新",
    );
    await expect(
      reviewerPage.getByText(extendedDeadline, { exact: false }).first(),
    ).toBeVisible();
    await reviewerPage.getByLabel("研究品質（0–5）").fill("4");
    await reviewerPage
      .getByLabel("給作者的評語", { exact: true })
      .fill("PUBLIC_BROWSER_FEEDBACK");
    await reviewerPage
      .getByLabel("僅主席可見的內部評語")
      .fill("PRIVATE_BROWSER_REVIEW");
    await reviewerPage.getByRole("button", { name: "正式送出並鎖定" }).click();
    await expect(reviewerPage.getByRole("status")).toContainText(
      "審查已正式送出",
    );
    await page.reload();
    await page
      .getByRole("combobox", { name: "正式投稿", exact: true })
      .selectOption(paper.id);
    await page
      .getByRole("combobox", { name: "指派審查輪次", exact: true })
      .selectOption("2");
    await page
      .getByRole("combobox", { name: "審查委員", exact: true })
      .selectOption(id(reviewerEmail));
    await page
      .getByRole("combobox", { name: "評分表版本", exact: true })
      .selectOption(formId);
    await page
      .getByLabel("已人工確認稿件內容與中繼資料符合匿名要求（雙盲必要）", {
        exact: true,
      })
      .check();
    await page
      .getByRole("button", { name: "指派此不可變版本", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "已指派不可變投稿版本",
    );
    await reviewerPage.reload();
    const secondRound = reviewerPage
      .locator("article")
      .filter({ hasText: "第 2 輪" });
    await secondRound
      .getByRole("button", { name: "接受指派", exact: true })
      .click();
    await expect(reviewerPage.getByRole("status")).toContainText(
      "審查狀態已更新",
    );
    await secondRound.getByLabel("研究品質（0–5）").fill("5");
    await secondRound
      .getByLabel("給作者的評語", { exact: true })
      .fill("SECOND_ROUND_BROWSER_FEEDBACK");
    await secondRound
      .getByLabel("僅主席可見的內部評語")
      .fill("SECOND_ROUND_PRIVATE");
    await secondRound
      .getByRole("button", { name: "正式送出並鎖定", exact: true })
      .click();
    await expect(reviewerPage.getByRole("status")).toContainText(
      "審查已正式送出",
    );
    const authorPage = await authorContext.newPage();
    await login(authorPage, authorEmail);
    await authorPage.goto("/reviews");
    await expect(
      authorPage.getByText("PUBLIC_BROWSER_FEEDBACK", { exact: true }),
    ).toHaveCount(0);
    const chairPage = await chairContext.newPage();
    await login(chairPage, chairEmail);
    await chairPage.goto("/reviews");
    // The title also exists in a hidden <option>; assert the visible review summary.
    await expect(
      chairPage
        .locator("summary")
        .filter({ hasText: paper.document.title })
        .filter({ hasText: "第 2 輪" }),
    ).toBeVisible();
    await chairPage
      .getByRole("combobox", { name: "正式投稿", exact: true })
      .selectOption(paper.id);
    await chairPage
      .getByRole("combobox", { name: "決議依據輪次", exact: true })
      .selectOption("2");
    await chairPage
      .getByRole("combobox", { name: "決議", exact: true })
      .selectOption("accept_oral");
    await chairPage
      .getByLabel("發布後給作者的訊息")
      .fill("PUBLIC_BROWSER_DECISION");
    await chairPage
      .getByLabel("內部決議理由", { exact: true })
      .fill("PRIVATE_BROWSER_DECISION_REASON");
    await chairPage.getByRole("button", { name: "儲存新決議版本" }).click();
    await expect(chairPage.getByRole("status")).toContainText("決議草稿已保存");
    await authorPage
      .getByRole("button", { name: "重新整理", exact: true })
      .click();
    await expect(
      authorPage.getByText("PUBLIC_BROWSER_DECISION", { exact: true }),
    ).toHaveCount(0);
    await chairPage
      .getByRole("button", { name: "明確發布此結果並通知作者" })
      .click();
    await expect(chairPage.getByRole("status")).toContainText("結果已發布");
    await authorPage
      .getByRole("button", { name: "重新整理", exact: true })
      .click();
    await expect(
      authorPage.getByText("PUBLIC_BROWSER_DECISION", { exact: true }),
    ).toBeVisible();
    await expect(
      authorPage.getByText("SECOND_ROUND_BROWSER_FEEDBACK", { exact: true }),
    ).toBeVisible();
    await expect(
      authorPage.getByText("PUBLIC_BROWSER_FEEDBACK", { exact: true }),
    ).toHaveCount(0);
    await expect(
      authorPage.getByText("SECOND_ROUND_PRIVATE", { exact: false }),
    ).toHaveCount(0);
    await expect(
      authorPage.getByRole("complementary", { name: "錄取後報名要求" }),
    ).toContainText("尚待完成報名");
    await expect(
      authorPage.getByRole("link", { name: "前往報名", exact: true }),
    ).toHaveAttribute("href", "/registration");
    await expect(
      authorPage.getByText("PRIVATE_BROWSER_REVIEW", { exact: false }),
    ).toHaveCount(0);
    await expect(
      authorPage.getByText("PRIVATE_BROWSER_DECISION_REASON", { exact: false }),
    ).toHaveCount(0);
  } finally {
    await Promise.all([
      reviewerContext.close(),
      chairContext.close(),
      authorContext.close(),
    ]);
  }
});

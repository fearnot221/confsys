import { test, expect } from "../helpers/browser-test.js";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { authFixture, password } from "../helpers/auth.js";
import { register, login } from "../helpers/browser-account.js";
const f = authFixture(),
  competitionIds: string[] = [],
  paperIds: string[] = [];
test.afterAll(async () => {
  await f.admin.query(
    "DELETE FROM confsys.competition_deadline_extensions WHERE assignment_id IN(SELECT id FROM confsys.competition_assignments WHERE competition_id=ANY($1::uuid[]))",
    [competitionIds],
  );
  await f.admin.query(
    "UPDATE confsys.competitions SET current_rubric_id=null,active_publication_id=null WHERE id=ANY($1::uuid[])",
    [competitionIds],
  );
  await f.admin.query(
    "DELETE FROM confsys.competition_scores WHERE assignment_id IN(SELECT id FROM confsys.competition_assignments WHERE competition_id=ANY($1::uuid[]))",
    [competitionIds],
  );
  for (const table of [
    "competition_publications",
    "competition_conflicts",
    "competition_assignments",
    "competition_entries",
    "competition_rubrics",
  ])
    await f.admin.query(
      `DELETE FROM confsys.${table} WHERE competition_id=ANY($1::uuid[])`,
      [competitionIds],
    );
  await f.admin.query(
    "DELETE FROM confsys.competitions WHERE id=ANY($1::uuid[])",
    [competitionIds],
  );
  for (const table of ["review_publications", "review_decisions"])
    await f.admin.query(
      `DELETE FROM confsys.${table} WHERE submission_id=ANY($1::uuid[])`,
      [paperIds],
    );
  await f.admin.query(
    "UPDATE confsys.submissions SET current_revision_id=null,submitted_version=null,state='draft' WHERE id=ANY($1::uuid[])",
    [paperIds],
  );
  await f.admin.query(
    "DELETE FROM confsys.submission_revisions WHERE submission_id=ANY($1::uuid[])",
    [paperIds],
  );
  await f.admin.query(
    "DELETE FROM confsys.submissions WHERE id=ANY($1::uuid[])",
    [paperIds],
  );
  await f.cleanup();
});
test("author applies; administrator qualifies and assigns; judge submits locked scores; explicit awards become public", async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  const adminEmail = f.email();
  await register(page, adminEmail);
  await login(page, adminEmail);
  const adminId = (await (await page.request.get("/api/auth/me")).json()).user
    .id;
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
      "Synthetic competition E2E",
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
  const authorContext = await browser.newContext({
      baseURL: process.env.PUBLIC_APP_ORIGIN!,
    }),
    author = await authorContext.newPage(),
    authorEmail = f.email();
  await register(author, authorEmail);
  await login(author, authorEmail);
  const authorId = (await (await author.request.get("/api/auth/me")).json())
    .user.id;
  const judgeContext = await browser.newContext({
      baseURL: process.env.PUBLIC_APP_ORIGIN!,
    }),
    judge = await judgeContext.newPage(),
    judgeEmail = f.email();
  await register(judge, judgeEmail);
  await login(judge, judgeEmail);
  const judgeId = (await (await judge.request.get("/api/auth/me")).json()).user
    .id;
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'competition_judge')",
    [judgeId],
  );
  await login(judge, judgeEmail);
  // Accepted manuscript is synthetic prerequisite data; all competition transitions below use real UI/API.
  const paperId = randomUUID(),
    revisionId = randomUUID(),
    decisionId = randomUUID(),
    document = {
      title: "Synthetic competition E2E paper",
      abstract: "Private manuscript abstract",
      keywords: [],
      correspondingAuthorIndex: 0,
      trackId: "research",
      topicIds: [],
      authors: [
        {
          name: "Synthetic presenter",
          email: authorEmail,
          affiliation: "Synthetic institute",
        },
      ],
      presenterIndex: 0,
      presentationPreference: "oral",
      competition: true,
      attachmentIds: [],
      slidesFileId: null,
      videoUrl: "",
    };
  paperIds.push(paperId);
  await f.admin.query(
    "INSERT INTO confsys.submissions(id,owner_id,version,document) VALUES($1,$2,1,$3)",
    [paperId, authorId, document],
  );
  await f.admin.query(
    "INSERT INTO confsys.submission_revisions(id,submission_id,owner_id,version,document,config_snapshot) SELECT $1,$2,$3,1,$4,document || jsonb_build_object('version',version) FROM confsys.submission_config",
    [revisionId, paperId, authorId, document],
  );
  await f.admin.query(
    "UPDATE confsys.submissions SET current_revision_id=$2,submitted_version=1,state='submitted' WHERE id=$1",
    [paperId, revisionId],
  );
  await f.admin.query(
    "INSERT INTO confsys.review_decisions(id,submission_id,revision_id,version,outcome,author_message,internal_reason,decided_by) VALUES($1,$2,$3,1,'accept_oral','Accepted','Synthetic prerequisite',$4)",
    [decisionId, paperId, revisionId, adminId],
  );
  await f.admin.query(
    "INSERT INTO confsys.review_publications(submission_id,decision_id,published_by) VALUES($1,$2,$3)",
    [paperId, decisionId, adminId],
  );
  await page.goto("/admin/competitions");
  await page.getByRole("button", { name: "新增競賽", exact: true }).click();
  await page
    .getByLabel("名稱", { exact: true })
    .first()
    .fill("Synthetic oral award");
  await page
    .getByLabel("參賽截止 UTC ISO")
    .fill(new Date(Date.now() + 3600000).toISOString());
  await page
    .getByLabel("評分截止 UTC ISO")
    .fill(new Date(Date.now() + 7200000).toISOString());
  await page.getByLabel("最少評審數").fill("1");
  await page
    .getByLabel("資格說明")
    .fill("Accepted oral manuscript with confirmed eligibility");
  await page.getByRole("button", { name: "儲存規則", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("操作已完成");
  const comp = (
    await (await page.request.get("/api/competitions/admin")).json()
  ).competitions.find(
    (c: { config: { name: string } }) =>
      c.config.name === "Synthetic oral award",
  );
  competitionIds.push(comp.id);
  await page.getByRole("button", { name: "關閉編輯" }).click();
  await author.goto("/competitions");
  await author
    .getByLabel("申請參賽競賽", { exact: true })
    .selectOption(comp.id);
  await author.getByLabel("錄取修訂版本 ID").fill(revisionId);
  await author.getByRole("button", { name: "提出申請" }).click();
  await expect(author.getByRole("status")).toContainText("操作已完成");
  const entry = (
    await (await author.request.get("/api/competitions")).json()
  ).entries.find((e: { competitionId: string }) => e.competitionId === comp.id);
  await page.reload();
  await page
    .getByLabel("操作理由", { exact: true })
    .fill("Eligibility checked against published accepted revision");
  await page.getByRole("button", { name: "確認資格", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("操作已完成");
  await page.getByRole("button", { name: "編輯規則", exact: true }).click();
  await page
    .getByLabel("參賽截止 UTC ISO")
    .fill(new Date(Date.now() - 1000).toISOString());
  await page.getByRole("button", { name: "儲存規則", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("操作已完成");
  await page.getByRole("button", { name: "關閉編輯" }).click();
  await page.getByLabel("評審帳號 ID").fill(judgeId);
  await page.getByRole("button", { name: "指派評審", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("操作已完成");
  const extendedDeadline = new Date(Date.now() + 7 * 86400000).toISOString();
  await page
    .getByLabel("展延後截止時間（含時區）", { exact: true })
    .fill(extendedDeadline);
  await page
    .getByLabel("展延理由（評審可見）", { exact: true })
    .fill("Synthetic competition deadline extension");
  await page
    .getByRole("button", { name: "展延此指派期限", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("操作已完成");
  await judge.goto("/judging");
  await expect(
    judge.getByText(extendedDeadline, { exact: false }).first(),
  ).toBeVisible();
  await expect(
    judge.getByRole("heading", { name: document.title }),
  ).toBeVisible();
  await judge.getByLabel("研究品質（滿分 100，權重 1）").fill("85");
  await judge
    .getByLabel("評語", { exact: true })
    .fill("Private competition score comment");
  await judge.getByLabel("確認正式評分送出後鎖定").check();
  await judge.getByRole("button", { name: "送出評分", exact: true }).click();
  await expect(judge.getByRole("status")).toContainText("操作已完成");
  await expect(
    judge.getByRole("button", { name: "送出評分", exact: true }),
  ).toBeDisabled();
  await page.reload();
  await page.getByLabel("得獎名單競賽", { exact: true }).selectOption(comp.id);
  await page.getByRole("button", { name: "新增獎項", exact: true }).click();
  await page.getByLabel("參賽 ID", { exact: true }).fill(entry.id);
  await page.getByLabel("獎項名稱").fill("Best oral presentation");
  await page
    .getByLabel("裁定／發布理由")
    .fill("Confirmed final score and eligibility");
  await page.getByRole("button", { name: "儲存得獎草稿" }).click();
  await expect(page.getByRole("status")).toContainText("操作已完成");
  const visitor = await browser.newContext({
      baseURL: process.env.PUBLIC_APP_ORIGIN!,
    }),
    publicPage = await visitor.newPage();
  await publicPage.goto("/competition-awards");
  await expect(
    publicPage.getByText("Best oral presentation", { exact: true }),
  ).toHaveCount(0);
  await page.getByLabel("重新驗證密碼", { exact: true }).fill(password);
  await page.getByRole("button", { name: "驗證", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("操作已完成");
  await page.getByLabel("確認將已儲存得獎名單公開並發送通知").check();
  await page.getByRole("button", { name: "發布已儲存名單" }).click();
  await expect(page.getByRole("status")).toContainText("操作已完成");
  await publicPage.reload();
  await expect(
    publicPage.getByRole("heading", { name: "Synthetic oral award" }),
  ).toBeVisible();
  await expect(
    publicPage.getByText("第 1 名 · Best oral presentation", { exact: true }),
  ).toBeVisible();
  await expect(
    publicPage.getByText("Private competition score comment"),
  ).toHaveCount(0);
  await expect(publicPage.getByText(authorEmail)).toHaveCount(0);
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.screenshot({
    path: "test-results/phase5-public-awards-mobile.png",
    fullPage: true,
  });
  await visitor.close();
  await judgeContext.close();
  await authorContext.close();
});

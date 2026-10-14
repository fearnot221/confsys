import { test, expect, type Page } from "../helpers/browser-test.js";
import { randomUUID } from "node:crypto";
import { authFixture } from "../helpers/auth.js";
import { register, login } from "../helpers/browser-account.js";
import { bootstrapAdministrator } from "../../apps/api/src/access/bootstrap.js";
const f = authFixture();
let baseline: Record<string, unknown>;
async function post(page: Page, path: string, body: unknown) {
  const csrf = await (await page.request.get("/api/auth/csrf")).json(),
    response = await page.request.post(path, {
      headers: {
        origin: process.env.PUBLIC_APP_ORIGIN!,
        "x-csrf-token": csrf.csrfToken,
      },
      data: body,
    });
  expect(response.status()).toBe(200);
  return response.json();
}
test.beforeAll(async () => {
  baseline = (await f.admin.query("SELECT * FROM confsys.submission_config"))
    .rows[0];
});
test.afterAll(async () => {
  const ids = (
    await f.admin.query("SELECT id FROM confsys.users WHERE email LIKE $1", [
      `${f.prefix}%`,
    ])
  ).rows.map((r) => r.id);
  await f.admin.query(
    "DELETE FROM confsys.presenter_change_requests WHERE requester_id=ANY($1::uuid[])",
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
test("owner requests, verified target explicitly consents, administrator approves immutable presenter revision", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const adminEmail = f.email(),
    ownerEmail = f.email(),
    targetEmail = f.email();
  await register(page, adminEmail);
  await login(page, adminEmail);
  const admin = (await (await page.request.get("/api/auth/me")).json()).user;
  await bootstrapAdministrator(
    f.admin,
    {
      conferenceName: f.config.CONFERENCE_NAME,
      origin: f.config.PUBLIC_APP_ORIGIN,
    },
    {
      targetId: admin.id,
      apply: true,
      reason: "Synthetic presenter browser bootstrap",
      confirmOrigin: f.config.PUBLIC_APP_ORIGIN,
    },
    randomUUID(),
  );
  await login(page, adminEmail);
  const current = await (
    await page.request.get("/api/submissions/config")
  ).json();
  await post(page, "/api/submissions/config", {
    ...current,
    opensAt: new Date(Date.now() - 60000).toISOString(),
    closesAt: new Date(Date.now() + 3600000).toISOString(),
    tracks: [{ id: "science", name: "Science", topics: [] }],
    requireRegistration: false,
    requireAttachment: false,
    mode: "abstract",
    presenterMustBeSubmitter: false,
    acceptedRegistrationDeadline: null,
  });
  const ownerContext = await browser.newContext({
      baseURL: process.env.PUBLIC_APP_ORIGIN!,
    }),
    targetContext = await browser.newContext({
      baseURL: process.env.PUBLIC_APP_ORIGIN!,
    }),
    owner = await ownerContext.newPage(),
    target = await targetContext.newPage();
  await register(owner, ownerEmail);
  await login(owner, ownerEmail);
  await register(target, targetEmail);
  await login(target, targetEmail);
  const paper = await post(owner, "/api/submissions/save", {
    id: randomUUID(),
    expectedVersion: 0,
    document: {
      title: "Presenter approval browser manuscript",
      abstract: "Synthetic browser workflow abstract",
      keywords: [],
      correspondingAuthorIndex: 0,
      trackId: "science",
      topicIds: [],
      authors: [
        { name: "原報告者", email: ownerEmail, affiliation: "合成研究所" },
        { name: "新報告者", email: targetEmail, affiliation: "合成大學" },
      ],
      presenterIndex: 0,
      presentationPreference: "either",
      competition: false,
      attachmentIds: [],
      slidesFileId: null,
      videoUrl: "",
    },
  });
  await post(owner, "/api/submissions/transition", {
    id: paper.id,
    expectedVersion: paper.version,
    action: "submit",
  });
  await owner.goto("/presenter-changes");
  await owner.getByLabel("選擇投稿", { exact: true }).selectOption(paper.id);
  await owner.getByLabel("新報告者", { exact: true }).selectOption("1");
  await owner
    .getByLabel("申請理由", { exact: true })
    .fill("本人無法出席，請共同作者報告");
  await owner
    .getByRole("button", { name: "提出變更申請", exact: true })
    .click();
  await expect(owner.getByRole("article")).toContainText("等待本人同意");
  await target.goto("/presenter-changes");
  await target.getByRole("button", { name: "邀請我接任", exact: true }).click();
  const card = target.getByRole("article");
  await expect(card).toContainText("Presenter approval browser manuscript");
  await card
    .getByLabel("處理理由（至少 3 字）", { exact: true })
    .fill("本人確認並同意接任報告者");
  await card.getByRole("button", { name: "本人同意接任", exact: true }).click();
  await expect(card).toContainText("本人已同意，等待審核");
  expect(
    (
      await target.request.get(
        `/api/submissions/detail?id=${paper.id}&scope=own`,
      )
    ).status(),
  ).toBe(404);
  await page.goto("/admin/presenter-changes");
  const adminCard = page
    .getByRole("article")
    .filter({ hasText: "Presenter approval browser manuscript" });
  await adminCard
    .getByLabel("處理理由（至少 3 字）", { exact: true })
    .fill("已核實本人同意並核准變更");
  await adminCard
    .getByRole("button", { name: "核准報告者變更", exact: true })
    .click();
  await expect(adminCard).toContainText("已核准，須重新錄取");
  await owner.reload();
  await expect(owner.getByRole("article")).toContainText(
    "原公開議程及得獎名單尚未改動",
  );
  const detail = await (
    await owner.request.get(`/api/submissions/detail?id=${paper.id}&scope=own`)
  ).json();
  expect(detail.revisions).toHaveLength(2);
  expect(detail.revisions[0].document.presenterIndex).toBe(1);
  expect(detail.revisions[1].document.presenterIndex).toBe(0);
  await ownerContext.close();
  await targetContext.close();
});

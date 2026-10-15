import { test, expect } from "../helpers/browser-test.js";
import { randomUUID } from "node:crypto";
import { authFixture } from "../helpers/auth.js";
import { register, login } from "../helpers/browser-account.js";
const f = authFixture(),
  batchId = randomUUID(),
  notificationId = randomUUID();
test.afterAll(async () => {
  const ids = (
    await f.admin.query<{ id: string }>(
      "SELECT id FROM confsys.users WHERE email LIKE $1",
      [`${f.prefix}%`],
    )
  ).rows.map((r) => r.id);
  await f.admin.query(
    "DELETE FROM confsys.notifications WHERE batch_id IN(SELECT id FROM confsys.notification_batches WHERE created_by=ANY($1::uuid[]))",
    [ids],
  );
  await f.admin.query(
    "DELETE FROM confsys.notification_batches WHERE created_by=ANY($1::uuid[])",
    [ids],
  );
  await f.cleanup();
});
test("operator retries a known failed synthetic batch once, while source history remains failed and real child mail is captured", async ({
  page,
}) => {
  const email = f.email();
  await register(page, email);
  await login(page, email);
  const actor = (await (await page.request.get("/api/auth/me")).json()).user;
  await f.admin.query(
    "INSERT INTO confsys.user_roles(user_id,role) VALUES($1,'conference_admin')",
    [actor.id],
  );
  // Terminal synthetic failure fixture: real pre-SMTP failures are independently
  // exercised through an actual refused loopback socket by integration tests.
  await f.admin.query(
    "INSERT INTO confsys.notification_batches(id,created_by,issuer_credential_version,idempotency_key,request_hash,subject,message_text,recipient_ids) SELECT $1,id,credential_version,$3,'synthetic-terminal-fixture','Synthetic retry browser','Authenticated conference announcement.',ARRAY[id] FROM confsys.users WHERE id=$2",
    [batchId, actor.id, randomUUID()],
  );
  await f.admin.query(
    "INSERT INTO confsys.notifications(id,scope,user_id,kind,request_id,expires_at,conference_name,event_key,message_subject,message_text,batch_id,status,result_code,attempts) VALUES($1,'business',$2,'business',$3,now()+interval '1 day','Synthetic conference',$4,'Synthetic retry browser','Authenticated conference announcement.',$5,'failed','CONNECT_FAILED',3)",
    [
      notificationId,
      actor.id,
      randomUUID(),
      `batch:${batchId}:${actor.id}`,
      batchId,
    ],
  );
  await page.goto("/admin/notifications");
  await expect(
    page.getByText("可人工重試 1 位：", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("重試理由：Synthetic retry browser", { exact: true })
    .fill("Capture SMTP restored after verified connection refusal");
  await page
    .getByRole("button", {
      name: "重試明確失敗：Synthetic retry browser",
      exact: true,
    })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "已建立明確失敗收件人的重試批次",
  );
  await expect(
    page.getByRole("button", {
      name: "重試明確失敗：Synthetic retry browser",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(page.getByText("失敗：1", { exact: true })).toBeVisible();
  await expect(
    page.getByText(`原批次：${batchId}`, { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () => {
        const result = await fetch(
          `${process.env.MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`,
        ).then((r) => r.json());
        return result.messages.filter((m: { Subject: string }) =>
          m.Subject.includes("Synthetic retry browser"),
        ).length;
      },
      { timeout: 15000 },
    )
    .toBe(1);
  await page
    .getByRole("button", { name: "重新整理批次狀態", exact: true })
    .click();
  await expect(page.getByText("SMTP 已接受：1", { exact: true })).toBeVisible();
  expect(
    (
      await f.admin.query(
        "SELECT status,result_code FROM confsys.notifications WHERE id=$1",
        [notificationId],
      )
    ).rows[0],
  ).toEqual({ status: "failed", result_code: "CONNECT_FAILED" });
});

import { useEffect, useState } from "react";
import type { PresenterChange, Submission } from "@confsys/contracts";
type CreateInput = {
  submissionId: string;
  sourceRevisionId: string;
  expectedSubmissionVersion: number;
  targetAuthorIndex: number;
  reason: string;
};
type Props = {
  candidates: Submission[];
  candidateOffset: number;
  candidateNextOffset: number | null;
  candidatePage: (offset: number) => unknown;
  administrative: boolean;
  canUse: boolean;
  scope: "own" | "incoming" | "admin";
  items: PresenterChange[];
  nextOffset: number | null;
  offset: number;
  busy: boolean;
  loading: boolean;
  error: string;
  message: string;
  changeScope: (scope: "own" | "incoming") => unknown;
  page: (offset: number) => unknown;
  reload: () => unknown;
  create: (input: CreateInput) => unknown;
  action: (
    row: PresenterChange,
    action: "accept" | "decline" | "cancel" | "approve" | "reject",
    reason: string,
  ) => unknown;
};
const labels: Record<PresenterChange["state"], string> = {
  requested: "等待本人同意",
  accepted: "本人已同意，等待審核",
  declined: "本人已拒絕",
  cancelled: "申請已取消",
  approved: "已核准，須重新錄取",
  rejected: "管理員已拒絕",
  expired: "已過期",
};
function RequestCard({ row, props }: { row: PresenterChange; props: Props }) {
  const [reason, setReason] = useState(""),
    active =
      ["requested", "accepted"].includes(row.state) &&
      Date.parse(row.expiresAt) > Date.now();
  return (
    <article className="space-y-3 rounded border p-4">
      <h2 className="text-lg font-semibold">
        #{row.projection.number} {row.projection.title}
      </h2>
      <p>
        {row.projection.previousName}（{row.projection.previousEmail}）→{" "}
        {row.projection.targetName}（{row.projection.targetEmail}）
      </p>
      <p>
        {labels[row.state]}；有效期限 {row.expiresAt}
      </p>
      <p>申請理由：{row.reason}</p>
      {row.responseReason && <p>本人回覆：{row.responseReason}</p>}
      {row.decisionReason && <p>處理理由：{row.decisionReason}</p>}
      {row.newRevisionId && (
        <p>新正式版本：{row.newRevisionId}。原公開議程及得獎名單尚未改動。</p>
      )}
      {active && (
        <fieldset disabled={props.busy} className="space-y-2">
          <label className="block" htmlFor={`presenter-reason-${row.id}`}>
            處理理由（至少 3 字）
            <textarea
              id={`presenter-reason-${row.id}`}
              required
              minLength={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="block w-full rounded border p-2"
            />
          </label>
          <div className="flex gap-3">
            {props.scope === "incoming" && row.state === "requested" && (
              <>
                <button
                  disabled={reason.trim().length < 3}
                  onClick={() => props.action(row, "accept", reason)}
                >
                  本人同意接任
                </button>
                <button
                  disabled={reason.trim().length < 3}
                  onClick={() => props.action(row, "decline", reason)}
                >
                  拒絕接任
                </button>
              </>
            )}
            {props.scope === "own" && (
              <button
                disabled={reason.trim().length < 3}
                onClick={() => props.action(row, "cancel", reason)}
              >
                取消申請
              </button>
            )}
            {props.scope === "admin" && (
              <>
                <button
                  disabled={
                    reason.trim().length < 3 || row.state !== "accepted"
                  }
                  onClick={() => props.action(row, "approve", reason)}
                >
                  核准報告者變更
                </button>
                <button
                  disabled={reason.trim().length < 3}
                  onClick={() => props.action(row, "reject", reason)}
                >
                  拒絕申請
                </button>
              </>
            )}
          </div>
        </fieldset>
      )}
    </article>
  );
}
export function PresenterChangesScreen(props: Props) {
  const [draft, setDraft] = useState<CreateInput>({
    submissionId: "",
    sourceRevisionId: "",
    expectedSubmissionVersion: 1,
    targetAuthorIndex: 1,
    reason: "",
  });
  useEffect(() => {
    const selected = props.candidates.find((s) => s.id === draft.submissionId);
    if (
      draft.submissionId &&
      (!selected || selected.version !== draft.expectedSubmissionVersion)
    )
      setDraft((d) => ({ ...d, submissionId: "", sourceRevisionId: "" }));
  }, [props.candidates, draft.submissionId, draft.expectedSubmissionVersion]);
  return (
    <main className="mx-auto max-w-4xl space-y-5 p-6">
      <h1 className="text-2xl font-semibold">報告者變更</h1>
      <p>
        僅能選擇最新正式投稿中已有的作者。新報告者須有本研討會已驗證帳號並本人同意，再由管理員核准。稿件所有權不會轉移。
      </p>
      <p>
        核准產生新版本，需重新發布錄取結果及重新處理議程與競賽；既有公開快照保留歷史內容。
      </p>
      {props.error && <p role="alert">{props.error}</p>}
      {props.message && <p role="status">{props.message}</p>}
      {props.loading && <p role="status">載入申請…</p>}
      {props.canUse && (
        <>
          <nav aria-label="報告者申請類別" className="flex gap-3">
            {!props.administrative && (
              <>
                <button
                  aria-pressed={props.scope === "own"}
                  onClick={() => props.changeScope("own")}
                >
                  我的申請
                </button>
                <button
                  aria-pressed={props.scope === "incoming"}
                  onClick={() => props.changeScope("incoming")}
                >
                  邀請我接任
                </button>
              </>
            )}
            <button onClick={() => props.reload()}>重新載入</button>
          </nav>
          {props.scope === "own" && (
            <form
              className="space-y-3 rounded border p-4"
              onSubmit={(e) => {
                e.preventDefault();
                props.create(draft);
              }}
            >
              <h2 className="text-lg font-semibold">新增申請</h2>
              <p id="presenter-help">
                只能選擇沒有未提交修改的正式投稿。若要修改內容，請先完成正常投稿流程。
              </p>
              <fieldset
                disabled={props.busy}
                aria-describedby="presenter-help"
                className="grid gap-3"
              >
                <label htmlFor="presenter-submission">
                  選擇投稿
                  <select
                    id="presenter-submission"
                    required
                    value={draft.submissionId}
                    onChange={(e) => {
                      const submission = props.candidates.find(
                        (s) => s.id === e.target.value,
                      );
                      if (submission)
                        setDraft({
                          ...draft,
                          submissionId: submission.id,
                          sourceRevisionId: submission.currentRevisionId ?? "",
                          expectedSubmissionVersion: submission.version,
                          targetAuthorIndex: submission.document.presenterIndex,
                        });
                      else
                        setDraft({
                          ...draft,
                          submissionId: "",
                          sourceRevisionId: "",
                        });
                    }}
                    className="block w-full border p-2"
                  >
                    <option value="">請選擇</option>
                    {props.candidates.map((s) => (
                      <option key={s.id} value={s.id}>
                        #{s.number} {s.document.title}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex gap-3">
                  <button
                    type="button"
                    disabled={props.candidateOffset === 0}
                    onClick={() =>
                      props.candidatePage(
                        Math.max(0, props.candidateOffset - 20),
                      )
                    }
                  >
                    前一頁投稿
                  </button>
                  <button
                    type="button"
                    disabled={props.candidateNextOffset === null}
                    onClick={() =>
                      props.candidateNextOffset !== null &&
                      props.candidatePage(props.candidateNextOffset)
                    }
                  >
                    下一頁投稿
                  </button>
                </div>
                <label htmlFor="presenter-target">
                  新報告者
                  <select
                    id="presenter-target"
                    required
                    value={draft.targetAuthorIndex}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        targetAuthorIndex: Number(e.target.value),
                      })
                    }
                    className="block w-full border p-2"
                  >
                    {props.candidates
                      .find((s) => s.id === draft.submissionId)
                      ?.document.authors.map((author, index) => (
                        <option key={index} value={index}>
                          {author.name}（{author.email}）
                        </option>
                      ))}
                  </select>
                </label>
                <label htmlFor="presenter-request-reason">
                  申請理由
                  <textarea
                    id="presenter-request-reason"
                    required
                    minLength={3}
                    maxLength={300}
                    value={draft.reason}
                    onChange={(e) =>
                      setDraft({ ...draft, reason: e.target.value })
                    }
                    className="block w-full border p-2"
                  />
                </label>
                <button type="submit">提出變更申請</button>
              </fieldset>
            </form>
          )}
          {props.items.map((row) => (
            <RequestCard key={row.id + row.version} row={row} props={props} />
          ))}
          {!props.loading && props.items.length === 0 && (
            <p>此類別沒有申請。</p>
          )}
          <div className="flex gap-3">
            <button
              disabled={props.offset === 0 || props.busy}
              onClick={() => props.page(Math.max(0, props.offset - 20))}
            >
              上一頁
            </button>
            <button
              disabled={props.nextOffset === null || props.busy}
              onClick={() =>
                props.nextOffset !== null && props.page(props.nextOffset)
              }
            >
              下一頁
            </button>
          </div>
        </>
      )}
    </main>
  );
}

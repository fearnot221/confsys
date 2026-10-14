import { useState } from "react";
import type {
  ReviewAssignment,
  ReviewBoard,
  ReviewFormDocument,
  ReviewScoreDocument,
  ReviewDecision,
  ReviewAuthorResult,
} from "@confsys/contracts";
type Props = {
  expired: boolean;
  busy: boolean;
  error: string;
  message: string;
  loading: boolean;
  canManage: boolean;
  canReview: boolean;
  canDecide: boolean;
  canConfigure: boolean;
  board: ReviewBoard | null;
  assigned: ReviewAssignment[];
  results: ReviewAuthorResult[];
  offset: number;
  next: number | null;
  onPage: (offset: number) => void;
  onRefresh: () => void;
  onReauthenticate: (password: string) => void;
  onConfigure: (document: ReviewFormDocument) => void;
  onScope: (userId: string, trackId: string, remove: boolean) => void;
  onConflict: (submissionId: string, reason: string) => void;
  onAssign: (
    submissionId: string,
    revisionId: string,
    reviewerId: string,
    formId: string,
    anonymousConfirmed: boolean,
  ) => void;
  onAction: (
    assignment: ReviewAssignment,
    action: string,
    document: ReviewScoreDocument,
    reason: string,
  ) => void;
  onDecide: (
    submissionId: string,
    revisionId: string,
    outcome: ReviewDecision["outcome"],
    authorMessage: string,
    internalReason: string,
    revisionDeadline: string | null,
  ) => void;
  onPublish: (id: string) => void;
  onDownload: (assignmentId: string, fileId: string) => void;
};
function ScoreForm({
  assignment,
  busy,
  onAction,
  onDownload,
}: {
  assignment: ReviewAssignment;
  busy: boolean;
  onAction: Props["onAction"];
  onDownload: Props["onDownload"];
}) {
  const [scores, setScores] = useState<Record<string, string>>(
    Object.fromEntries(
      assignment.document.scores.map((s) => [s.criterionId, String(s.value)]),
    ),
  );
  const [authorComment, setAuthorComment] = useState(
      assignment.document.authorComment,
    ),
    [privateComment, setPrivateComment] = useState(
      assignment.document.privateComment,
    ),
    [reason, setReason] = useState("");
  const document: ReviewScoreDocument = {
    scores: assignment.form.document.criteria
      .filter((c) => scores[c.id] !== undefined && scores[c.id] !== "")
      .map((c) => ({ criterionId: c.id, value: Number(scores[c.id]) })),
    authorComment,
    privateComment,
  };
  return (
    <article className="auth-panel">
      <h3>{assignment.paper.title || "已停止的審查指派"}</h3>
      <p>
        狀態：{assignment.state} · 評分表版本 {assignment.form.version} · 截止{" "}
        {assignment.form.document.closesAt}
      </p>
      {assignment.paper.authors.length > 0 && (
        <p>
          作者：
          {assignment.paper.authors
            .map((a) => `${a.name}（${a.affiliation}）`)
            .join("、")}
        </p>
      )}
      <p>{assignment.paper.abstract}</p>
      {assignment.paper.attachmentIds.map((id, index) => (
        <button
          key={id}
          disabled={
            busy || !["accepted", "submitted"].includes(assignment.state)
          }
          onClick={() => onDownload(assignment.id, id)}
        >
          下載稿件 {index + 1}
        </button>
      ))}
      {assignment.state === "invited" && (
        <>
          <button
            disabled={busy}
            onClick={() => onAction(assignment, "accept", document, "")}
          >
            接受指派
          </button>
          <button
            disabled={busy}
            onClick={() => onAction(assignment, "decline", document, "")}
          >
            婉拒指派
          </button>
        </>
      )}
      {["accepted", "submitted"].includes(assignment.state) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAction(assignment, "save", document, "");
          }}
        >
          {assignment.form.document.criteria.map((c) => (
            <label key={c.id}>
              {c.label}（0–{c.max}）
              <input
                type="number"
                min={0}
                max={c.max}
                step="any"
                disabled={assignment.state === "submitted" || busy}
                value={scores[c.id] ?? ""}
                onChange={(e) =>
                  setScores({ ...scores, [c.id]: e.target.value })
                }
              />
            </label>
          ))}
          <label>
            給作者的評語
            <textarea
              maxLength={10000}
              disabled={assignment.state === "submitted" || busy}
              value={authorComment}
              onChange={(e) => setAuthorComment(e.target.value)}
            />
          </label>
          <label>
            僅主席可見的內部評語
            <textarea
              maxLength={10000}
              disabled={assignment.state === "submitted" || busy}
              value={privateComment}
              onChange={(e) => setPrivateComment(e.target.value)}
            />
          </label>
          {assignment.state === "accepted" && (
            <>
              <button disabled={busy}>儲存審查草稿</button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onAction(assignment, "submit", document, "")}
              >
                正式送出並鎖定
              </button>
            </>
          )}
        </form>
      )}
      {assignment.state !== "conflicted" && assignment.state !== "declined" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onAction(assignment, "conflict", document, reason);
          }}
        >
          <label>
            利益衝突說明
            <input
              required
              minLength={3}
              maxLength={1000}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button disabled={busy}>申報衝突並停止審查</button>
        </form>
      )}
    </article>
  );
}
function Configure({
  busy,
  onConfigure,
  onScope,
  onReauthenticate,
}: {
  busy: boolean;
  onConfigure: Props["onConfigure"];
  onScope: Props["onScope"];
  onReauthenticate: Props["onReauthenticate"];
}) {
  const [name, setName] = useState("論文審查"),
    [mode, setMode] = useState<"single_blind" | "double_blind">("double_blind"),
    [closesAt, setClosesAt] = useState("");
  const [criteria, setCriteria] = useState([
      { id: "quality", label: "研究品質", max: 5 },
    ]),
    [chairId, setChairId] = useState(""),
    [trackId, setTrackId] = useState(""),
    [password, setPassword] = useState("");
  return (
    <section className="auth-panel">
      <h2>審查設定</h2>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onReauthenticate(password);
          setPassword("");
        }}
      >
        <label>
          目前管理密碼
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <button disabled={busy}>重新驗證管理密碼</button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfigure({
            name,
            mode,
            closesAt: new Date(closesAt).toISOString(),
            criteria,
          });
        }}
      >
        <label>
          評分表名稱
          <input
            required
            maxLength={200}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label>
          審查模式
          <select
            value={mode}
            onChange={(e) =>
              setMode(
                e.target.value === "single_blind"
                  ? "single_blind"
                  : "double_blind",
              )
            }
          >
            <option value="double_blind">雙盲（須人工確認匿名稿）</option>
            <option value="single_blind">
              單盲（審查者可見作者名稱／單位）
            </option>
          </select>
        </label>
        <label>
          審查截止（本機時區）
          <input
            type="datetime-local"
            required
            value={closesAt}
            onChange={(e) => setClosesAt(e.target.value)}
          />
        </label>
        {criteria.map((c, index) => (
          <fieldset key={c.id}>
            <legend>評分項目 {index + 1}</legend>
            <label>
              項目名稱
              <input
                required
                maxLength={200}
                value={c.label}
                onChange={(e) =>
                  setCriteria(
                    criteria.map((item, i) =>
                      i === index ? { ...item, label: e.target.value } : item,
                    ),
                  )
                }
              />
            </label>
            <label>
              最高分
              <input
                type="number"
                required
                min={1}
                max={100}
                value={c.max}
                onChange={(e) =>
                  setCriteria(
                    criteria.map((item, i) =>
                      i === index
                        ? { ...item, max: Number(e.target.value) }
                        : item,
                    ),
                  )
                }
              />
            </label>
          </fieldset>
        ))}
        <button
          type="button"
          disabled={criteria.length >= 20 || busy}
          onClick={() =>
            setCriteria([
              ...criteria,
              { id: `criterion-${criteria.length + 1}`, label: "", max: 5 },
            ])
          }
        >
          新增評分項目
        </button>
        <button disabled={busy}>建立評分表新版本</button>
      </form>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onScope(chairId, trackId, false);
        }}
      >
        <h3>主席分組範圍</h3>
        <p>請先於帳號管理授予主席角色；這裡僅設定可處理的分組。</p>
        <label>
          主席本地帳號 UUID
          <input
            required
            value={chairId}
            onChange={(e) => setChairId(e.target.value)}
          />
        </label>
        <label>
          分組代碼
          <input
            required
            maxLength={80}
            value={trackId}
            onChange={(e) => setTrackId(e.target.value)}
          />
        </label>
        <button disabled={busy}>授予分組範圍</button>
        <button
          type="button"
          disabled={busy || !chairId || !trackId}
          onClick={() => onScope(chairId, trackId, true)}
        >
          撤銷分組範圍
        </button>
      </form>
    </section>
  );
}
function Manage({
  board,
  busy,
  canDecide,
  onAssign,
  onConflict,
  onDecide,
  onPublish,
}: {
  board: ReviewBoard;
  busy: boolean;
  canDecide: boolean;
  onAssign: Props["onAssign"];
  onConflict: Props["onConflict"];
  onDecide: Props["onDecide"];
  onPublish: Props["onPublish"];
}) {
  const [paperId, setPaperId] = useState(""),
    [reviewerId, setReviewerId] = useState(""),
    [formId, setFormId] = useState(""),
    [anonymous, setAnonymous] = useState(false);
  const [outcome, setOutcome] =
      useState<ReviewDecision["outcome"]>("accept_oral"),
    [authorMessage, setAuthorMessage] = useState(""),
    [internalReason, setInternalReason] = useState(""),
    [deadline, setDeadline] = useState("");
  const paper = board.papers.find((p) => p.submissionId === paperId);
  return (
    <section className="auth-panel">
      <h2>指派與決議</h2>
      <label>
        正式投稿
        <select value={paperId} onChange={(e) => setPaperId(e.target.value)}>
          <option value="">請選擇稿件</option>
          {board.papers.map((p) => (
            <option key={p.submissionId} value={p.submissionId}>
              {p.title} · {p.trackId}
            </option>
          ))}
        </select>
      </label>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (paper)
            onAssign(
              paper.submissionId,
              paper.revisionId,
              reviewerId,
              formId,
              anonymous,
            );
        }}
      >
        <label>
          審查委員
          <select
            required
            value={reviewerId}
            onChange={(e) => setReviewerId(e.target.value)}
          >
            <option value="">請選擇委員</option>
            {board.reviewers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          評分表版本
          <select
            required
            value={formId}
            onChange={(e) => setFormId(e.target.value)}
          >
            <option value="">請選擇評分表</option>
            {board.forms.map((f) => (
              <option key={f.id} value={f.id}>
                {f.document.name} v{f.version} · {f.document.mode}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={anonymous}
            onChange={(e) => setAnonymous(e.target.checked)}
          />
          已人工確認稿件內容與中繼資料符合匿名要求（雙盲必要）
        </label>
        <button disabled={busy || !paper}>指派此不可變版本</button>
      </form>
      <h3>審查進度與評語</h3>
      {board.assignments.length === 0 && <p>此頁沒有可查看的指派。</p>}
      {board.assignments.map((a) => (
        <details key={a.id}>
          <summary>
            {a.paper.title} · {a.state} · 委員{" "}
            {board.reviewers.find((r) => r.id === a.reviewerId)?.email ??
              a.reviewerId}
          </summary>
          <p>版本 {a.revisionId}</p>
          <ul>
            {a.document.scores.map((s) => (
              <li key={s.criterionId}>
                {
                  a.form.document.criteria.find((c) => c.id === s.criterionId)
                    ?.label
                }
                : {s.value}
              </li>
            ))}
          </ul>
          <p>給作者：{a.document.authorComment}</p>
          <p>內部：{a.document.privateComment}</p>
        </details>
      ))}
      {canDecide && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (paper)
              onDecide(
                paper.submissionId,
                paper.revisionId,
                outcome,
                authorMessage,
                internalReason,
                outcome === "revision_requested"
                  ? new Date(deadline).toISOString()
                  : null,
              );
          }}
        >
          <h3>主席決議草稿</h3>
          <label>
            決議
            <select
              value={outcome}
              onChange={(e) => {
                const v = e.target.value;
                if (
                  v === "accept_oral" ||
                  v === "accept_poster" ||
                  v === "reject" ||
                  v === "revision_requested"
                )
                  setOutcome(v);
              }}
            >
              <option value="accept_oral">口頭錄取</option>
              <option value="accept_poster">壁報錄取</option>
              <option value="reject">不錄取</option>
              <option value="revision_requested">補件</option>
            </select>
          </label>
          {outcome === "revision_requested" && (
            <label>
              補件截止（本機時區）
              <input
                type="datetime-local"
                required
                value={deadline}
                onChange={(e) => setDeadline(e.target.value)}
              />
            </label>
          )}
          <label>
            發布後給作者的訊息
            <textarea
              required
              maxLength={4000}
              value={authorMessage}
              onChange={(e) => setAuthorMessage(e.target.value)}
            />
          </label>
          <label>
            內部決議理由
            <textarea
              required
              minLength={3}
              maxLength={4000}
              value={internalReason}
              onChange={(e) => setInternalReason(e.target.value)}
            />
          </label>
          <button disabled={busy || !paper}>儲存新決議版本</button>
        </form>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (paper) onConflict(paper.submissionId, internalReason);
        }}
      >
        <label>
          本人利益衝突說明
          <input
            required
            minLength={3}
            maxLength={1000}
            value={internalReason}
            onChange={(e) => setInternalReason(e.target.value)}
          />
        </label>
        <button disabled={busy || !paper}>申報本人衝突並停止處理</button>
      </form>
      <h3>決議歷程與發布</h3>
      {board.decisions.map((d) => (
        <article key={d.id}>
          <p>
            {board.papers.find((p) => p.submissionId === d.submissionId)
              ?.title ?? d.submissionId}{" "}
            · 決議 v{d.version} · {d.outcome} ·{" "}
            {d.published ? "目前已發布" : "草稿／歷史版本"}
          </p>
          <p>{d.authorMessage}</p>
          <p>內部理由：{d.internalReason}</p>
          {canDecide && !d.published && (
            <button disabled={busy} onClick={() => onPublish(d.id)}>
              明確發布此結果並通知作者
            </button>
          )}
        </article>
      ))}
    </section>
  );
}
export function ReviewsScreen(props: Props) {
  return (
    <main className="layout access-panel">
      <h1>審查與結果工作台</h1>
      <p>
        <a href="/auth/account">帳號</a> · <a href="/submissions">投稿工作台</a>{" "}
        · <a href="/access/accounts">帳號角色管理</a>
      </p>
      {props.loading && <p role="status">載入中…</p>}
      {props.error && <p role="alert">{props.error}</p>}
      {props.message && <p role="status">{props.message}</p>}
      {props.expired ? (
        <a href="/auth/login">重新登入</a>
      ) : (
        <button disabled={props.busy} onClick={props.onRefresh}>
          重新整理
        </button>
      )}
      {props.canConfigure && (
        <Configure
          busy={props.busy}
          onConfigure={props.onConfigure}
          onScope={props.onScope}
          onReauthenticate={props.onReauthenticate}
        />
      )}
      {props.canManage && props.board && (
        <Manage
          board={props.board}
          busy={props.busy}
          canDecide={props.canDecide}
          onAssign={props.onAssign}
          onConflict={props.onConflict}
          onDecide={props.onDecide}
          onPublish={props.onPublish}
        />
      )}
      {props.canReview && (
        <section>
          <h2>我的審查指派</h2>
          {props.assigned.length === 0 && <p>目前沒有可查看的指派。</p>}
          {props.assigned.map((a) => (
            <ScoreForm
              key={`${a.id}:${a.version}`}
              assignment={a}
              busy={props.busy}
              onAction={props.onAction}
              onDownload={props.onDownload}
            />
          ))}
        </section>
      )}
      {!props.expired && (
        <section>
          <h2>我的已發布投稿結果</h2>
          {props.results.length === 0 && (
            <p>目前尚無已發布結果；草稿投稿不代表不錄取。</p>
          )}
          {props.results.map((r) => (
            <article key={r.submissionId}>
              <h3>投稿 {r.submissionId}</h3>
              <p>
                {r.outcome} · 發布 {r.publishedAt}
              </p>
              <p>{r.authorMessage}</p>
              {r.revisionDeadline && <p>補件截止：{r.revisionDeadline}</p>}
              {r.authorComments.map((text, i) => (
                <blockquote key={i}>{text}</blockquote>
              ))}
            </article>
          ))}
        </section>
      )}
      <button
        disabled={props.busy || props.offset === 0}
        onClick={() => props.onPage(Math.max(0, props.offset - 20))}
      >
        上一頁
      </button>
      <button
        disabled={props.busy || props.next === null}
        onClick={() => {
          if (props.next !== null) props.onPage(props.next);
        }}
      >
        下一頁
      </button>
    </main>
  );
}

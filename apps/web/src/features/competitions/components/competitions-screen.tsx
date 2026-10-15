import {
  DeadlineHistory,
  DeadlineExtension,
} from "@confsys/ui";
import { useState } from "react";
import type {
  CompetitionAdmin,
  CompetitionConfig,
  CompetitionPublic,
  CompetitionCatalog,
  CompetitionJudging,
  competitionEndpoints,
} from "@confsys/contracts";
type Props = {
  mode: "author" | "admin" | "judge";
  admin: CompetitionAdmin | null;
  author: CompetitionCatalog | null;
  judge: CompetitionJudging | null;
  loading: boolean;
  busy: boolean;
  error: string;
  message: string;
  offset: number;
  onPage: (v: number) => void;
  onRetry: () => void;
  newId: () => string;
  onAction: (op: keyof typeof competitionEndpoints, input: unknown) => void;
  onReauthenticate: (password: string) => void;
};
const emptyConfig: CompetitionConfig = {
  name: "",
  kind: "oral",
  registrationClosesAt: "",
  judgingClosesAt: "",
  requireRegistration: false,
  minimumJudges: 2,
  tiePolicy: "shared",
  eligibilityNote: "",
  criteria: [{ id: "quality", label: "研究品質", maximum: 100, weight: 1 }],
};
export function CompetitionsScreen(p: Props) {
  const [editing, setEditing] = useState<{
      id: string;
      expectedVersion: number;
      config: CompetitionConfig;
    } | null>(null),
    [reason, setReason] = useState(""),
    [revisionId, setRevisionId] = useState(""),
    [replacementRevisionId, setReplacementRevisionId] = useState(""),
    [competitionId, setCompetitionId] = useState(""),
    [judgeId, setJudgeId] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(false),
    [awards, setAwards] = useState<
      { entryId: string; label: string; rank: number }[]
    >([]);
  const cs = p.admin?.competitions ?? p.author?.competitions ?? [],
    entries = p.admin?.entries ?? p.author?.entries ?? [],
    next =
      p.admin?.nextOffset ??
      p.author?.nextOffset ??
      p.judge?.nextOffset ??
      null;
  const selected = cs.find((c) => c.id === competitionId);
  const patch = (value: Partial<CompetitionConfig>) => {
    if (editing)
      setEditing({ ...editing, config: { ...editing.config, ...value } });
  };
  return (
    <main className="page-shell">
      <h1>
        {p.mode === "admin"
          ? "競賽管理"
          : p.mode === "judge"
            ? "競賽評審工作台"
            : "我的競賽"}
      </h1>
      <nav>
        <a href="/account">帳號</a> · <a href="/submissions">投稿</a> ·{" "}
        <a href="/competition-awards">公開得獎名單</a>
      </nav>
      {p.loading && <p role="status">載入中…</p>}
      {p.error && <p role="alert">{p.error}</p>}
      {p.message && <p role="status">{p.message}</p>}
      <button onClick={p.onRetry} disabled={p.busy}>
        重新整理
      </button>
      {p.mode === "admin" && p.admin && (
        <>
          <button
            disabled={p.busy}
            onClick={() =>
              setEditing({
                id: p.newId(),
                expectedVersion: 0,
                config: emptyConfig,
              })
            }
          >
            新增競賽
          </button>
          {cs.map((c) => (
            <article key={c.id}>
              <h2>{c.config.name}</h2>
              <p>
                {c.config.kind} · 版本 {c.version} · {c.config.eligibilityNote}
              </p>
              <button
                disabled={p.busy}
                onClick={() =>
                  setEditing({
                    id: c.id,
                    expectedVersion: c.version,
                    config: c.config,
                  })
                }
              >
                編輯規則
              </button>
            </article>
          ))}
        </>
      )}
      {editing && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            p.onAction("competitionConfigure", editing);
          }}
        >
          <h2>競賽規則與評分表</h2>
          <p>已有評審指派後規則即鎖定。變更需建立新的競賽。</p>
          <fieldset disabled={p.busy}>
            <label>
              名稱
              <input
                required
                maxLength={200}
                value={editing.config.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </label>
            <label>
              類型
              <select
                aria-label="競賽類型"
                value={editing.config.kind}
                onChange={(e) =>
                  patch({ kind: e.target.value === "oral" ? "oral" : "poster" })
                }
              >
                <option value="oral">口頭</option>
                <option value="poster">壁報</option>
              </select>
            </label>
            <label>
              參賽截止 UTC ISO
              <input
                required
                placeholder="2030-01-01T00:00:00Z"
                value={editing.config.registrationClosesAt}
                onChange={(e) =>
                  patch({ registrationClosesAt: e.target.value })
                }
              />
            </label>
            <label>
              評分截止 UTC ISO
              <input
                required
                placeholder="2030-01-02T00:00:00Z"
                value={editing.config.judgingClosesAt}
                onChange={(e) => patch({ judgingClosesAt: e.target.value })}
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={editing.config.requireRegistration}
                onChange={(e) =>
                  patch({ requireRegistration: e.target.checked })
                }
              />
              必須已確認報名
            </label>
            <label>
              最少評審數
              <input
                type="number"
                min={1}
                max={10}
                value={editing.config.minimumJudges}
                onChange={(e) =>
                  patch({ minimumJudges: Number(e.target.value) })
                }
              />
            </label>
            <label>
              同分政策
              <select
                aria-label="同分政策"
                value={editing.config.tiePolicy}
                onChange={(e) =>
                  patch({
                    tiePolicy:
                      e.target.value === "shared" ? "shared" : "manual",
                  })
                }
              >
                <option value="shared">同分共同名次</option>
                <option value="manual">行政裁定並記錄理由</option>
              </select>
            </label>
            <label>
              資格說明
              <textarea
                required
                value={editing.config.eligibilityNote}
                onChange={(e) => patch({ eligibilityNote: e.target.value })}
              />
            </label>
            {editing.config.criteria.map((c, index) => (
              <fieldset key={index}>
                <legend>評分項目 {index + 1}</legend>
                {(["id", "label"] as const).map((key) => (
                  <label key={key}>
                    {key === "id" ? "穩定識別碼（小寫英文）" : "名稱"}
                    <input
                      required
                      value={c[key]}
                      onChange={(e) =>
                        patch({
                          criteria: editing.config.criteria.map((item, i) =>
                            i === index
                              ? { ...item, [key]: e.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                {(["maximum", "weight"] as const).map((key) => (
                  <label key={key}>
                    {key === "maximum" ? "滿分" : "權重"}
                    <input
                      type="number"
                      min={1}
                      max={key === "maximum" ? 1000 : 100}
                      value={c[key]}
                      onChange={(e) =>
                        patch({
                          criteria: editing.config.criteria.map((item, i) =>
                            i === index
                              ? { ...item, [key]: Number(e.target.value) }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <button
                  type="button"
                  disabled={editing.config.criteria.length === 1}
                  onClick={() =>
                    patch({
                      criteria: editing.config.criteria.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  移除此項
                </button>
              </fieldset>
            ))}
            <button
              type="button"
              disabled={editing.config.criteria.length >= 20}
              onClick={() =>
                patch({
                  criteria: [
                    ...editing.config.criteria,
                    {
                      id: `criterion-${editing.config.criteria.length + 1}`,
                      label: "",
                      maximum: 100,
                      weight: 1,
                    },
                  ],
                })
              }
            >
              新增評分項目
            </button>
            <button type="submit">儲存規則</button>
            <button type="button" onClick={() => setEditing(null)}>
              關閉編輯
            </button>
          </fieldset>
        </form>
      )}
      {p.author && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            p.onAction("competitionEnroll", { competitionId, revisionId });
          }}
        >
          <h2>申請參賽</h2>
          <p>
            請使用已發布錄取且投稿勾選參賽的修訂版本。版本 ID
            可在投稿詳細頁取得。
          </p>
          <fieldset disabled={p.busy}>
            <label>
              競賽
              <select
                aria-label="申請參賽競賽"
                required
                value={competitionId}
                onChange={(e) => setCompetitionId(e.target.value)}
              >
                <option value="">請選擇</option>
                {cs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.config.name}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <p>
                {selected.config.eligibilityNote}；截止{" "}
                {selected.config.registrationClosesAt}
              </p>
            )}
            <label>
              錄取修訂版本 ID
              <input
                required
                value={revisionId}
                onChange={(e) => setRevisionId(e.target.value)}
              />
            </label>
            <button>提出申請</button>
          </fieldset>
        </form>
      )}
      {entries.length > 0 && (
        <section>
          <h2>參賽名單</h2>
          <label>
            操作理由
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={3}
              maxLength={2000}
            />
          </label>
          {p.admin && (
            <label>
              評審帳號 ID
              <input
                value={judgeId}
                onChange={(e) => setJudgeId(e.target.value)}
              />
            </label>
          )}
          <label htmlFor="competition-replacement-revision">
            已重新接受並發布的報告者更換版本 ID
          </label>
          <input
            id="competition-replacement-revision"
            value={replacementRevisionId}
            onChange={(e) => setReplacementRevisionId(e.target.value)}
          />
          <p>
            更換申請會建立全新的待審資格；舊評分及公開名單保留，須重新確認資格、指派評審及評分。
          </p>
          {entries.map((e) => (
            <article key={e.id}>
              <h3>{e.title}</h3>
              <p>
                {e.presenterName} · {e.state} · 版本 {e.version}
              </p>
              <p>參賽 ID：{e.id}</p>
              {e.predecessorId && (
                <p>
                  前一參賽紀錄：{e.predecessorId} · 更換原因：
                  {e.replacementReason}
                </p>
              )}
              {e.reason && <p>{e.reason}</p>}
              <fieldset disabled={p.busy || reason.trim().length < 3}>
                <button
                  disabled={!replacementRevisionId}
                  onClick={() =>
                    p.onAction("competitionReplaceEntry", {
                      predecessorId: e.id,
                      expectedVersion: e.version,
                      revisionId: replacementRevisionId,
                      reason,
                    })
                  }
                >
                  以核准的新報告者版本重新申請
                </button>
                {p.admin && e.state === "requested" && (
                  <>
                    <button
                      onClick={() =>
                        p.onAction("competitionEntry", {
                          id: e.id,
                          expectedVersion: e.version,
                          action: "approve",
                          reason,
                        })
                      }
                    >
                      確認資格
                    </button>
                    <button
                      onClick={() =>
                        p.onAction("competitionEntry", {
                          id: e.id,
                          expectedVersion: e.version,
                          action: "reject",
                          reason,
                        })
                      }
                    >
                      不符合資格
                    </button>
                  </>
                )}
                {p.admin && e.state === "approved" && (
                  <button
                    onClick={() =>
                      p.onAction("competitionEntry", {
                        id: e.id,
                        expectedVersion: e.version,
                        action: "disqualify",
                        reason,
                      })
                    }
                  >
                    取消資格
                  </button>
                )}
                {p.author && ["requested", "approved"].includes(e.state) && (
                  <button
                    onClick={() =>
                      p.onAction("competitionEntry", {
                        id: e.id,
                        expectedVersion: e.version,
                        action: "withdraw",
                        reason,
                      })
                    }
                  >
                    撤回參賽
                  </button>
                )}
              </fieldset>
              {p.admin && e.state === "approved" && (
                <>
                  <button
                    disabled={p.busy || !judgeId}
                    onClick={() =>
                      p.onAction("competitionAssign", {
                        entryId: e.id,
                        judgeId,
                      })
                    }
                  >
                    指派評審
                  </button>
                  <p>
                    已交評分{" "}
                    {p.admin.totals.find((t) => t.entryId === e.id)
                      ?.submitted ?? 0}
                    ；未交{" "}
                    {p.admin.totals.find((t) => t.entryId === e.id)?.missing ??
                      0}
                    ；分數{" "}
                    {(
                      (p.admin.totals.find((t) => t.entryId === e.id)
                        ?.basisPoints ?? 0) / 100
                    ).toFixed(2)}
                    %
                  </p>
                </>
              )}
              {p.admin?.assignments
                .filter((a) => a.entryId === e.id)
                .map((a) => (
                  <div key={a.id}>
                    <DeadlineHistory
                      original={a.config.judgingClosesAt}
                      effective={a.effectiveDeadline}
                      history={a.deadlineHistory}
                    />
                    {a.state === "assigned" && (
                      <DeadlineExtension
                        busy={p.busy}
                        onExtend={(deadline, reason) =>
                          p.onAction("competitionExtendDeadline", {
                            id: p.newId(),
                            assignmentId: a.id,
                            expectedVersion: a.version,
                            deadline,
                            reason,
                          })
                        }
                      />
                    )}
                    <p>
                      評審 {a.judgeId}：{a.state}
                    </p>
                    <button
                      disabled={
                        p.busy ||
                        reason.trim().length < 3 ||
                        a.state === "cancelled"
                      }
                      onClick={() =>
                        p.onAction("competitionCancel", {
                          assignmentId: a.id,
                          reason,
                        })
                      }
                    >
                      撤銷此指派
                    </button>
                    <button
                      disabled={
                        p.busy ||
                        reason.trim().length < 3 ||
                        a.state !== "assigned"
                      }
                      onClick={() =>
                        p.onAction("competitionRemind", {
                          assignmentId: a.id,
                          idempotencyKey: p.newId(),
                          reason,
                        })
                      }
                    >
                      提醒待評分評審
                    </button>
                  </div>
                ))}
            </article>
          ))}
        </section>
      )}
      {p.judge?.assignments.map((a) => (
        <ScoreForm
          key={`${a.id}:${a.version}`}
          assignment={a}
          busy={p.busy}
          onAction={p.onAction}
        />
      ))}
      {p.admin && (
        <section>
          <h2>得獎草稿與發布</h2>
          <label>
            競賽
            <select
              aria-label="得獎名單競賽"
              value={competitionId}
              onChange={(e) => {
                setCompetitionId(e.target.value);
                setAwards(
                  p.admin?.awardDrafts.find(
                    (d) => d.competitionId === e.target.value,
                  )?.awards ?? [],
                );
              }}
            >
              <option value="">請選擇</option>
              {cs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.config.name}
                </option>
              ))}
            </select>
          </label>
          <p>
            須關閉參賽、處理所有資格申請，並取得所有有效指派的評分及最少評審數。分數相同依規則共享名次或記錄裁定理由。
          </p>
          {awards.map((a, index) => (
            <fieldset key={index}>
              <legend>獎項 {index + 1}</legend>
              <label>
                參賽 ID
                <input
                  value={a.entryId}
                  onChange={(e) =>
                    setAwards(
                      awards.map((item, i) =>
                        i === index
                          ? { ...item, entryId: e.target.value }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                獎項名稱
                <input
                  value={a.label}
                  onChange={(e) =>
                    setAwards(
                      awards.map((item, i) =>
                        i === index ? { ...item, label: e.target.value } : item,
                      ),
                    )
                  }
                />
              </label>
              <label>
                名次
                <input
                  type="number"
                  min={1}
                  value={a.rank}
                  onChange={(e) =>
                    setAwards(
                      awards.map((item, i) =>
                        i === index
                          ? { ...item, rank: Number(e.target.value) }
                          : item,
                      ),
                    )
                  }
                />
              </label>
              <button
                onClick={() => setAwards(awards.filter((_, i) => i !== index))}
              >
                移除
              </button>
            </fieldset>
          ))}
          <button
            disabled={p.busy || awards.length >= 100}
            onClick={() =>
              setAwards([
                ...awards,
                { entryId: "", label: "", rank: awards.length + 1 },
              ])
            }
          >
            新增獎項
          </button>
          <label>
            裁定／發布理由
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <button
            disabled={
              p.busy || !selected || reason.trim().length < 3 || !awards.length
            }
            onClick={() =>
              selected &&
              p.onAction("competitionAwards", {
                competitionId: selected.id,
                expectedVersion: selected.version,
                awards,
                reason,
              })
            }
          >
            儲存得獎草稿
          </button>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              p.onReauthenticate(password);
              setPassword("");
            }}
          >
            <label>
              重新驗證密碼
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button disabled={p.busy}>驗證</button>
          </form>
          <label>
            <input
              type="checkbox"
              checked={confirm}
              onChange={(e) => setConfirm(e.target.checked)}
            />
            確認將已儲存得獎名單公開並發送通知
          </label>
          <button
            disabled={p.busy || !selected || !confirm}
            onClick={() =>
              selected &&
              p.onAction("competitionPublish", {
                competitionId: selected.id,
                expectedVersion: selected.version,
              })
            }
          >
            發布已儲存名單
          </button>
        </section>
      )}
      <nav aria-label="名單分頁">
        <button
          disabled={p.busy || p.offset === 0}
          onClick={() => p.onPage(Math.max(0, p.offset - 20))}
        >
          上一頁
        </button>
        <span>第 {Math.floor(p.offset / 20) + 1} 頁</span>
        <button
          disabled={p.busy || next === null}
          onClick={() => next !== null && p.onPage(next)}
        >
          下一頁
        </button>
      </nav>
    </main>
  );
}
function ScoreForm({
  assignment: a,
  busy,
  onAction,
}: {
  assignment: CompetitionJudging["assignments"][number];
  busy: boolean;
  onAction: Props["onAction"];
}) {
  const [document, setDocument] = useState(a.document),
    [reason, setReason] = useState(""),
    [confirm, setConfirm] = useState(false);
  return (
    <article>
      <h2>{a.title}</h2>
      <p>
        {a.presenterName} · {a.config.name} · {a.state} · 截止{" "}
        {a.effectiveDeadline}
      </p>
      <DeadlineHistory
        original={a.config.judgingClosesAt}
        effective={a.effectiveDeadline}
        history={a.deadlineHistory}
      />
      <fieldset disabled={busy || a.state !== "assigned"}>
        {a.config.criteria.map((c) => (
          <label key={c.id}>
            {c.label}（滿分 {c.maximum}，權重 {c.weight}）
            <input
              type="number"
              min={0}
              max={c.maximum}
              value={
                document.scores.find((s) => s.criterionId === c.id)?.value ?? ""
              }
              onChange={(e) =>
                setDocument({
                  ...document,
                  scores: [
                    ...document.scores.filter((s) => s.criterionId !== c.id),
                    ...(e.target.value === ""
                      ? []
                      : [{ criterionId: c.id, value: Number(e.target.value) }]),
                  ],
                })
              }
            />
          </label>
        ))}
        <label>
          評語
          <textarea
            maxLength={4000}
            value={document.comment}
            onChange={(e) =>
              setDocument({ ...document, comment: e.target.value })
            }
          />
        </label>
        <button
          onClick={() =>
            onAction("competitionScore", {
              assignmentId: a.id,
              expectedVersion: a.version,
              action: "save",
              document,
            })
          }
        >
          儲存草稿
        </button>
        <label>
          <input
            type="checkbox"
            checked={confirm}
            onChange={(e) => setConfirm(e.target.checked)}
          />
          確認正式評分送出後鎖定
        </label>
        <button
          disabled={!confirm}
          onClick={() =>
            onAction("competitionScore", {
              assignmentId: a.id,
              expectedVersion: a.version,
              action: "submit",
              document,
            })
          }
        >
          送出評分
        </button>
      </fieldset>
      <label>
        利益衝突理由
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <button
        disabled={
          busy ||
          reason.trim().length < 3 ||
          a.state === "cancelled" ||
          a.state === "conflicted"
        }
        onClick={() =>
          onAction("competitionConflict", { assignmentId: a.id, reason })
        }
      >
        宣告利益衝突（排除評分）
      </button>
    </article>
  );
}
export function PublicCompetitionAwardsContent({
  data,
}: {
  data: CompetitionPublic;
}) {
  return (
    <>
      {data.competitions.length === 0 && <p>尚未發布得獎名單。</p>}
      {data.competitions.map((c) => (
        <section key={c.id}>
          <h2>{c.name}</h2>
          <p>發布時間 {c.publishedAt}</p>
          <ol>
            {c.awards.map((a, i) => (
              <li key={i}>
                <strong>
                  第 {a.rank} 名 · {a.label}
                </strong>
                <p>
                  {a.title} — {a.presenterName} ·{" "}
                  {(a.basisPoints / 100).toFixed(2)}%
                </p>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}
export function PublicCompetitionAwardsScreen(p: {
  data: CompetitionPublic | null;
  loading: boolean;
  error: string;
  onRetry: () => void;
}) {
  return (
    <main className="page-shell">
      <h1>競賽得獎名單</h1>
      <a href="/">研討會首頁</a>
      {p.loading && <p role="status">載入中…</p>}
      {p.error && (
        <p role="alert">
          {p.error}
          <button onClick={p.onRetry}>重試</button>
        </p>
      )}
      {p.data && <PublicCompetitionAwardsContent data={p.data} />}
    </main>
  );
}

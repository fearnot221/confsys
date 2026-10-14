import { useState } from "react";
import type {
  Submission,
  SubmissionConfig,
  SubmissionDocument,
} from "@confsys/contracts";
type Revision = {
  id: string;
  submissionId: string;
  version: number;
  document: SubmissionDocument;
  submittedAt: string;
};
type Props = {
  admin: boolean;
  expired: boolean;
  loading: boolean;
  busy: boolean;
  error: string;
  message: string;
  items: Submission[];
  offset: number;
  nextOffset: number | null;
  current: Submission | null;
  revisions: Revision[];
  settings: SubmissionConfig | null;
  canConfigure: boolean;
  dirty: boolean;
  onOffset: (v: number) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onChange: (d: SubmissionDocument) => void;
  onUpload: (file: File, slides: boolean) => void;
  onDownload: (id: string) => void;
  revisionOffset: number;
  nextRevisionOffset: number | null;
  onRevisionOffset: (offset: number) => void;
  onSettings: (d: SubmissionConfig) => void;
  onReload: () => void;
  onRetry: () => void;
  onSave: () => void;
  onTransition: (action: "submit" | "withdraw") => void;
  onConfigure: () => void;
};
export function SubmissionsScreen(p: Props) {
  const [confirm, setConfirm] = useState<"submit" | "withdraw" | null>(null),
    [historical, setHistorical] = useState<string | null>(null),
    [preview, setPreview] = useState(false);
  const current = p.current,
    d = current?.document,
    config = p.settings;
  const change = (patch: Partial<SubmissionDocument>) => {
    if (d) p.onChange({ ...d, ...patch });
  };
  const readOnly = p.admin || p.busy || current?.state === "withdrawn";
  return (
    <main className="layout">
      <header>
        <a href="/">回首頁</a> · <a href="/auth/account">帳號</a> ·{" "}
        <a href="/account/files">私有檔案</a>
        <h1>{p.admin ? "投稿行政工作台" : "作者投稿工作台"}</h1>
        <p>
          草稿尚未正式提交；每次正式提交均保留獨立歷史版本。共同作者 Email
          不會自動取得帳號存取權。
        </p>
      </header>
      {p.loading && <p role="status">載入中…</p>}
      {p.error && (
        <div role="alert" id="submission-error">
          <p>{p.error}</p>
          <button onClick={p.onRetry}>重試讀取</button>
        </div>
      )}
      {p.message && <p role="status">{p.message}</p>}
      {!p.expired && config && (
        <p>
          投稿窗口（UTC）：{config.opensAt ?? "尚未設定"} 至{" "}
          {config.closesAt ?? "尚未設定"}。
          {config.requireRegistration
            ? "正式提交前須完成報名。"
            : "可先投稿後報名。"}
        </p>
      )}
      {!p.expired && p.admin && p.canConfigure && config && (
        <details>
          <summary>投稿窗口、主題與必要條件</summary>
          <fieldset disabled={p.busy}>
            <legend>設定版本 {config.version}</legend>
            <label>
              開始時間（含 Z 的 UTC ISO 格式）
              <input
                value={config.opensAt ?? ""}
                placeholder="2026-10-15T00:00:00Z"
                onChange={(e) =>
                  p.onSettings({ ...config, opensAt: e.target.value || null })
                }
              />
            </label>
            <label>
              截止時間（UTC，截止瞬間不接受投稿）
              <input
                value={config.closesAt ?? ""}
                placeholder="2026-11-15T00:00:00Z"
                onChange={(e) =>
                  p.onSettings({ ...config, closesAt: e.target.value || null })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={config.requireRegistration}
                onChange={(e) =>
                  p.onSettings({
                    ...config,
                    requireRegistration: e.target.checked,
                  })
                }
              />
              須先完成報名
            </label>
            <label>
              <input
                type="checkbox"
                checked={config.requireAttachment}
                onChange={(e) =>
                  p.onSettings({
                    ...config,
                    requireAttachment: e.target.checked,
                  })
                }
              />
              至少一份稿件附件
            </label>
            <label htmlFor="submission-mode">投稿模式</label>
            <select
              id="submission-mode"
              value={config.mode}
              onChange={(e) =>
                p.onSettings({
                  ...config,
                  mode:
                    e.target.value === "full_paper" ? "full_paper" : "abstract",
                })
              }
            >
              <option value="abstract">摘要</option>
              <option value="full_paper">完整論文（至少一份 PDF）</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={config.presenterMustBeSubmitter}
                onChange={(e) =>
                  p.onSettings({
                    ...config,
                    presenterMustBeSubmitter: e.target.checked,
                  })
                }
              />
              報告者 Email 須為投稿帳號的已驗證信箱
            </label>
            {config.tracks.map((track, i) => (
              <fieldset key={i}>
                <legend>主題軌 {i + 1}</legend>
                <label>
                  代碼（小寫英數、連字號）
                  <input
                    value={track.id}
                    onChange={(e) =>
                      p.onSettings({
                        ...config,
                        tracks: config.tracks.map((t, n) =>
                          n === i ? { ...t, id: e.target.value } : t,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  名稱
                  <input
                    value={track.name}
                    onChange={(e) =>
                      p.onSettings({
                        ...config,
                        tracks: config.tracks.map((t, n) =>
                          n === i ? { ...t, name: e.target.value } : t,
                        ),
                      })
                    }
                  />
                </label>
                {track.topics.map((topic, j) => (
                  <div key={j}>
                    <label>
                      分類代碼
                      <input
                        value={topic.id}
                        onChange={(e) =>
                          p.onSettings({
                            ...config,
                            tracks: config.tracks.map((t, n) =>
                              n === i
                                ? {
                                    ...t,
                                    topics: t.topics.map((v, m) =>
                                      m === j
                                        ? { ...v, id: e.target.value }
                                        : v,
                                    ),
                                  }
                                : t,
                            ),
                          })
                        }
                      />
                    </label>
                    <label>
                      分類名稱
                      <input
                        value={topic.name}
                        onChange={(e) =>
                          p.onSettings({
                            ...config,
                            tracks: config.tracks.map((t, n) =>
                              n === i
                                ? {
                                    ...t,
                                    topics: t.topics.map((v, m) =>
                                      m === j
                                        ? { ...v, name: e.target.value }
                                        : v,
                                    ),
                                  }
                                : t,
                            ),
                          })
                        }
                      />
                    </label>
                    <button
                      onClick={() =>
                        p.onSettings({
                          ...config,
                          tracks: config.tracks.map((t, n) =>
                            n === i
                              ? {
                                  ...t,
                                  topics: t.topics.filter((_, m) => m !== j),
                                }
                              : t,
                          ),
                        })
                      }
                    >
                      移除分類
                    </button>
                  </div>
                ))}
                <button
                  onClick={() =>
                    p.onSettings({
                      ...config,
                      tracks: config.tracks.map((t, n) =>
                        n === i
                          ? {
                              ...t,
                              topics: [...t.topics, { id: "", name: "" }],
                            }
                          : t,
                      ),
                    })
                  }
                >
                  新增分類
                </button>
                <button
                  onClick={() =>
                    p.onSettings({
                      ...config,
                      tracks: config.tracks.filter((_, n) => n !== i),
                    })
                  }
                >
                  移除主題軌
                </button>
              </fieldset>
            ))}
            <button
              onClick={() =>
                p.onSettings({
                  ...config,
                  tracks: [...config.tracks, { id: "", name: "", topics: [] }],
                })
              }
            >
              新增主題軌
            </button>
            <button onClick={p.onConfigure}>儲存投稿設定</button>
          </fieldset>
        </details>
      )}
      {!p.expired && (
        <section>
          <h2>{p.admin ? "全部投稿（私有資料）" : "我的投稿"}</h2>
          {!p.admin && (
            <button
              disabled={p.busy}
              onClick={() => {
                setHistorical(null);
                setConfirm(null);
                p.onNew();
              }}
            >
              建立新草稿
            </button>
          )}
          {!p.items.length && !p.loading && <p>目前沒有稿件。</p>}
          <ul>
            {p.items.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setHistorical(null);
                    setConfirm(null);
                    p.onSelect(s.id);
                  }}
                >
                  {s.document.title || "未命名稿件"}
                </button>{" "}
                —{" "}
                {s.state === "draft"
                  ? "草稿未提交"
                  : s.state === "submitted"
                    ? "已提交"
                    : "已撤回"}{" "}
                · 草稿版本 {s.version} · 已提交版本 {s.submittedVersion ?? "無"}
              </li>
            ))}
          </ul>
          <button
            disabled={p.offset === 0 || p.busy}
            onClick={() => p.onOffset(Math.max(0, p.offset - 20))}
          >
            上一頁
          </button>
          <button
            disabled={p.nextOffset === null || p.busy}
            onClick={() => {
              if (p.nextOffset !== null) p.onOffset(p.nextOffset);
            }}
          >
            下一頁
          </button>
        </section>
      )}
      {current && d && (
        <section>
          <h2>{p.admin ? "檢視稿件" : "編輯稿件"}</h2>
          <p>
            已提交修訂 ID：{current.currentRevisionId ?? "無"}
            <br />
            稿件編號：{current.number || "尚未儲存"} · 識別碼：{current.id} ·{" "}
            {p.dirty ? "有未儲存內容" : "已載入伺服器版本"}
          </p>
          <p id="submission-requirements">
            正式提交需填寫題目、摘要、主題軌、作者姓名／Email／單位，並選擇報告者與通訊作者。
            {config?.mode === "full_paper"
              ? "本會議要求至少一份完整論文 PDF。"
              : ""}
            {config?.presenterMustBeSubmitter
              ? "報告者 Email 必須與目前帳號的已驗證信箱相同。"
              : ""}
          </p>
          <fieldset
            disabled={readOnly}
            aria-describedby={`submission-requirements${p.error ? " submission-error" : ""}`}
          >
            <legend>稿件內容</legend>
            <label>
              標題
              <input
                maxLength={500}
                value={d.title}
                onChange={(e) => change({ title: e.target.value })}
              />
            </label>
            <label>
              摘要
              <textarea
                rows={10}
                maxLength={20000}
                value={d.abstract}
                onChange={(e) => change({ abstract: e.target.value })}
              />
            </label>
            <label>
              關鍵字（每行一筆）
              <textarea
                value={d.keywords.join("\n")}
                onChange={(e) =>
                  change({ keywords: e.target.value.split("\n") })
                }
              />
            </label>
            <label htmlFor="submission-track">主題軌</label>
            <select
              id="submission-track"
              value={d.trackId}
              onChange={(e) =>
                change({ trackId: e.target.value, topicIds: [] })
              }
            >
              <option value="">請選擇</option>
              {config?.tracks.map((t) => (
                <option value={t.id} key={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <fieldset>
              <legend>主題分類</legend>
              {config?.tracks
                .find((t) => t.id === d.trackId)
                ?.topics.map((t) => (
                  <label key={t.id}>
                    <input
                      type="checkbox"
                      checked={d.topicIds.includes(t.id)}
                      onChange={(e) =>
                        change({
                          topicIds: e.target.checked
                            ? [...d.topicIds, t.id]
                            : d.topicIds.filter((id) => id !== t.id),
                        })
                      }
                    />
                    {t.name}
                  </label>
                ))}
            </fieldset>
            <fieldset>
              <legend>作者（此順序會保存到提交版本）</legend>
              {d.authors.map((a, i) => (
                <fieldset key={i}>
                  <legend>作者 {i + 1}</legend>
                  <label>
                    姓名
                    <input
                      value={a.name}
                      maxLength={200}
                      onChange={(e) =>
                        change({
                          authors: d.authors.map((v, n) =>
                            n === i ? { ...v, name: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    Email
                    <input
                      type="email"
                      value={a.email}
                      onChange={(e) =>
                        change({
                          authors: d.authors.map((v, n) =>
                            n === i ? { ...v, email: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    單位
                    <input
                      value={a.affiliation}
                      maxLength={300}
                      onChange={(e) =>
                        change({
                          authors: d.authors.map((v, n) =>
                            n === i ? { ...v, affiliation: e.target.value } : v,
                          ),
                        })
                      }
                    />
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="corresponding-author"
                      checked={d.correspondingAuthorIndex === i}
                      onChange={() => change({ correspondingAuthorIndex: i })}
                    />
                    此作者為通訊作者
                  </label>
                  <label>
                    <input
                      type="radio"
                      name="presenter"
                      checked={d.presenterIndex === i}
                      onChange={() => change({ presenterIndex: i })}
                    />
                    此作者為報告者
                  </label>
                  <button
                    onClick={() =>
                      change({
                        authors: d.authors.filter((_, n) => n !== i),
                        presenterIndex: 0,
                        correspondingAuthorIndex: 0,
                      })
                    }
                  >
                    移除作者
                  </button>
                </fieldset>
              ))}
              <button
                onClick={() =>
                  change({
                    authors: [
                      ...d.authors,
                      { name: "", email: "", affiliation: "" },
                    ],
                  })
                }
              >
                新增共同作者
              </button>
            </fieldset>
            <label htmlFor="submission-preference">發表意願</label>
            <select
              id="submission-preference"
              value={d.presentationPreference}
              onChange={(e) =>
                change({
                  presentationPreference: e.target
                    .value as SubmissionDocument["presentationPreference"],
                })
              }
            >
              <option value="either">皆可</option>
              <option value="oral">口頭</option>
              <option value="poster">壁報</option>
            </select>
            <label>
              <input
                type="checkbox"
                checked={d.competition}
                onChange={(e) => change({ competition: e.target.checked })}
              />
              有意參加競賽
            </label>
            <label>
              已有稿件附件識別碼（每行一筆，可從私有檔案頁複製）
              <textarea
                value={d.attachmentIds.join("\n")}
                onChange={(e) =>
                  change({
                    attachmentIds: e.target.value.split(/\s+/).filter(Boolean),
                  })
                }
              />
            </label>
            {!p.admin && (
              <>
                <label>
                  上傳稿件附件（PDF、PNG、JPEG；最大 8 MiB）
                  <input
                    type="file"
                    accept="application/pdf,image/png,image/jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) p.onUpload(file, false);
                      e.target.value = "";
                    }}
                  />
                </label>
                <label>
                  上傳簡報（PDF）
                  <input
                    type="file"
                    accept="application/pdf"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) p.onUpload(file, true);
                      e.target.value = "";
                    }}
                  />
                </label>
              </>
            )}
            <label>
              簡報檔案識別碼
              <input
                value={d.slidesFileId ?? ""}
                onChange={(e) =>
                  change({ slidesFileId: e.target.value || null })
                }
              />
            </label>
            <label>
              影片 HTTPS 網址
              <input
                type="url"
                value={d.videoUrl}
                onChange={(e) => change({ videoUrl: e.target.value })}
              />
            </label>
          </fieldset>
          {!p.admin && (
            <ul>
              {[
                ...d.attachmentIds,
                ...(d.slidesFileId ? [d.slidesFileId] : []),
              ].map((id) => (
                <li key={id}>
                  <button disabled={p.busy} onClick={() => p.onDownload(id)}>
                    下載附件 {id}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {!p.admin && (
            <div>
              <button
                disabled={p.busy || current.state === "withdrawn"}
                onClick={p.onSave}
              >
                儲存草稿
              </button>
              <button
                disabled={
                  p.busy ||
                  p.dirty ||
                  !current.version ||
                  current.state === "withdrawn"
                }
                onClick={() => setConfirm("submit")}
              >
                正式提交此版本
              </button>
              <button
                disabled={
                  p.busy || !current.version || current.state === "withdrawn"
                }
                onClick={() => setConfirm("withdraw")}
              >
                撤回稿件
              </button>
              <button disabled={p.busy} onClick={p.onReload}>
                捨棄本地修改並重新載入
              </button>
            </div>
          )}
          {confirm && !p.admin && (
            <div role="group" aria-label="確認稿件操作">
              <p>
                {confirm === "submit"
                  ? "正式提交後將保存不可變版本。確認送出？"
                  : "撤稿後不可自行恢復。確認撤回？"}
              </p>
              <button
                disabled={p.busy}
                onClick={() => {
                  p.onTransition(confirm);
                  setConfirm(null);
                }}
              >
                確認
              </button>
              <button onClick={() => setConfirm(null)}>取消</button>
            </div>
          )}
          <button
            onClick={() => setPreview(!preview)}
            aria-expanded={preview}
            aria-controls="submission-draft-preview"
          >
            預覽目前草稿
          </button>
          {preview && (
            <article id="submission-draft-preview" aria-label="草稿預覽">
              <p>預覽尚未正式提交的目前內容；不代表已錄取。</p>
              <h3>{d.title || "未命名稿件"}</h3>
              <p style={{ whiteSpace: "pre-wrap" }}>{d.abstract}</p>
              <p>關鍵字：{d.keywords.join("、") || "無"}</p>
              <ol>
                {d.authors.map((author, i) => (
                  <li key={i}>
                    {author.name} — {author.affiliation}
                    {i === d.presenterIndex ? "（報告者）" : ""}
                    {i === d.correspondingAuthorIndex ? "（通訊作者）" : ""}
                  </li>
                ))}
              </ol>
              <p>
                稿件附件 {d.attachmentIds.length} 件；簡報{" "}
                {d.slidesFileId ? "已附" : "無"}。
              </p>
            </article>
          )}
          <h3>不可變提交歷史</h3>
          <button
            disabled={!p.revisionOffset || p.busy}
            onClick={() => {
              setHistorical(null);
              p.onRevisionOffset(Math.max(0, p.revisionOffset - 20));
            }}
          >
            較新版本
          </button>
          <button
            disabled={p.nextRevisionOffset === null || p.busy}
            onClick={() => {
              if (p.nextRevisionOffset !== null) {
                setHistorical(null);
                p.onRevisionOffset(p.nextRevisionOffset);
              }
            }}
          >
            較舊版本
          </button>
          <ul>
            {p.revisions.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() =>
                    setHistorical(historical === r.id ? null : r.id)
                  }
                  aria-expanded={historical === r.id}
                  aria-controls={`submission-revision-${r.id}`}
                >
                  版本 {r.version} · {r.submittedAt}
                </button>
              </li>
            ))}
          </ul>
          {p.revisions
            .filter((r) => r.id === historical)
            .map((r) => (
              <article key={r.id} id={`submission-revision-${r.id}`}>
                <h4>{r.document.title}</h4>
                <p style={{ whiteSpace: "pre-wrap" }}>{r.document.abstract}</p>
                <ol>
                  {r.document.authors.map((a, i) => (
                    <li key={i}>
                      {a.name} — {a.affiliation}
                      {i === r.document.presenterIndex ? "（報告者）" : ""}
                    </li>
                  ))}
                </ol>
                <p>附件：{r.document.attachmentIds.join(", ") || "無"}</p>
              </article>
            ))}
        </section>
      )}
    </main>
  );
}

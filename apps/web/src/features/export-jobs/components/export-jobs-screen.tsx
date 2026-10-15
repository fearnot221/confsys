import { useState } from "react";
import type { ExportJob } from "@confsys/contracts";
type Props = {
  canExport: boolean;
  busy: boolean;
  error: string;
  message: string;
  items: ExportJob[];
  offset: number;
  nextOffset: number | null;
  download: { url: string; name: string } | null;
  page: (offset: number) => void;
  refresh: () => void;
  reauthenticate: (password: string) => Promise<void>;
  create: (
    kind: "registrations" | "submissions" | "emails",
    purpose: string,
  ) => Promise<void>;
  newRequest: () => void;
  fetchDownload: (job: ExportJob) => Promise<void>;
};
const labels = {
  pending: "等待處理",
  processing: "處理中",
  ready: "可下載",
  failed: "處理失敗",
  cancelled: "已取消（權限失效）",
  expired: "已到期",
};
export function ExportJobsScreen(p: Props) {
  const [purpose, setPurpose] = useState("");
  const [kind, setKind] = useState<"registrations" | "submissions" | "emails">(
      "registrations",
    ),
    [password, setPassword] = useState("");
  return (
    <main className="layout access-panel">
      <h1>完整資料背景匯出</h1>
      <p>
        <a href="/notifications">通知與統計</a> ·{" "}
        <a href="/auth/account">帳號</a>
      </p>
      {p.error && <p role="alert">{p.error}</p>}
      {p.message && <p role="status">{p.message}</p>}
      {!p.canExport ? (
        <p>
          需要目前有效的資料匯出權限。請<a href="/auth/login">登入</a>。
        </p>
      ) : (
        <>
          <p>
            背景工作匯出選定資料集的全部資料列，以 worker
            開始讀取時的同一資料庫快照為準。不是前100筆預覽。檔案上限64MiB，超過上限會明確失敗，不會截斷。要求建立後24小時到期；最多同時5個待處理工作。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void p.reauthenticate(password);
              setPassword("");
            }}
          >
            <h2>近期密碼驗證</h2>
            <label>
              目前密碼
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            <button disabled={p.busy}>驗證密碼</button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void p.create(kind, purpose);
            }}
          >
            <label htmlFor="export-job-kind">完整匯出資料集</label>
            <select
              id="export-job-kind"
              value={kind}
              onChange={(e) => {
                const v = e.target.value;
                if (
                  v === "registrations" ||
                  v === "submissions" ||
                  v === "emails"
                )
                  setKind(v);
              }}
            >
              <option value="registrations">報名資料</option>
              <option value="submissions">投稿摘要</option>
              <option value="emails">已驗證啟用帳號 Email</option>
            </select>
            <label htmlFor="export-job-purpose">匯出用途</label>
            <textarea
              id="export-job-purpose"
              required
              minLength={3}
              maxLength={300}
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
            />
            <p>
              請填寫具體用途，勿填入不必要個資。用途會與下載稽核一併保存；用途改變請建立新要求。
            </p>
            <button disabled={p.busy}>建立背景匯出工作</button>
            <button disabled={p.busy} type="button" onClick={p.newRequest}>
              準備另一份新快照
            </button>
          </form>
          <p>
            同一份要求的重試不會重複建立工作。再次匯出最新資料時，先按「準備另一份新快照」。工作不會匯出附件、密碼、原始權杖或私密審查內容。
          </p>
          <button disabled={p.busy} onClick={p.refresh}>
            重新整理匯出狀態
          </button>
          {p.download && (
            <p>
              <a href={p.download.url} download={p.download.name}>
                下載已驗證 CSV
              </a>
            </p>
          )}
          <ul>
            {p.items.map((j) => (
              <li key={j.id} className="record">
                <h2>
                  {j.kind} · {labels[j.status]}
                </h2>
                <p>
                  建立：{new Date(j.createdAt).toLocaleString()} · 到期：
                  {new Date(j.expiresAt).toLocaleString()}
                </p>
                <p>用途：{j.purpose}</p>
                {j.snapshotAt && (
                  <p>
                    資料快照：{new Date(j.snapshotAt).toLocaleString()} ·{" "}
                    {j.rows}筆
                  </p>
                )}
                {j.resultCode && <p>結果代碼：{j.resultCode}</p>}
                {j.status === "ready" && (
                  <button
                    disabled={p.busy}
                    onClick={() => void p.fetchDownload(j)}
                  >
                    驗證並取得 CSV：{j.id}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <button
            disabled={p.busy || p.offset === 0}
            onClick={() => p.page(Math.max(0, p.offset - 20))}
          >
            上一頁匯出
          </button>{" "}
          <button
            disabled={p.busy || p.nextOffset === null}
            onClick={() => p.page(p.nextOffset!)}
          >
            下一頁匯出
          </button>
        </>
      )}
    </main>
  );
}

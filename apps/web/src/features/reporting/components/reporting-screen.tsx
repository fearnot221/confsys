import { useState } from "react";
import type {
  NotificationPage,
  ReportingStats,
  AuthorPreview,
  ExportPage,
} from "@confsys/contracts";
type Props = {
  ready: boolean;
  busy: boolean;
  error: string;
  message: string;
  canRead: boolean;
  canExport: boolean;
  canPreview: boolean;
  feed: NotificationPage | undefined;
  stats: ReportingStats | undefined;
  preview: AuthorPreview | null;
  exported: ExportPage | null;
  offset: number;
  exportKind: "registrations" | "submissions" | "emails";
  page: (offset: number) => void;
  read: (id: string) => Promise<void>;
  exportPage: (
    kind: "registrations" | "submissions" | "emails",
    offset: number,
  ) => Promise<void>;
  previewAuthor: (id: string, reason: string) => Promise<void>;
  closePreview: () => void;
  reauthenticate: (password: string) => Promise<void>;
};
const statuses = {
  pending: "待寄送",
  processing: "寄送處理中",
  accepted: "郵件伺服器已接受",
  failed: "寄送失敗",
  unknown: "寄送結果不確定",
  cancelled: "寄送已取消",
};
export function ReportingScreen(p: Props) {
  const [password, setPassword] = useState("");
  const [kind, setKind] = useState<"registrations" | "submissions" | "emails">(
      "registrations",
    ),
    [id, setId] = useState(""),
    [reason, setReason] = useState("");
  return (
    <main className="mx-auto max-w-5xl space-y-8 p-6">
      <header>
        <h1>通知與管理報表</h1>
        <p>
          <a href="/">返回官網</a> · <a href="/reviews">審查工作台</a>
        </p>
      </header>
      {p.error && <p role="alert">{p.error}</p>}
      {p.message && <p role="status">{p.message}</p>}
      {!p.ready ? (
        <p>
          請<a href="/auth/login">登入本場研討會帳號</a>後查看資料。
        </p>
      ) : (
        <>
          <section aria-labelledby="notification-heading">
            <h2 id="notification-heading">我的通知</h2>
            <p>寄送狀態反映郵件伺服器處理結果，不代表收件人已閱讀。</p>
            {p.feed?.items.length === 0 && <p>尚無通知。</p>}
            <ul>
              {p.feed?.items.map((n) => (
                <li key={n.id} className="my-4 border p-4">
                  <h3>{n.subject}</h3>
                  <p className="whitespace-pre-wrap">{n.text}</p>
                  <p>
                    {new Date(n.createdAt).toLocaleString()} ·{" "}
                    {statuses[n.status]} · {n.readAt ? "已讀" : "未讀"}
                  </p>
                  {!n.readAt && (
                    <button disabled={p.busy} onClick={() => void p.read(n.id)}>
                      標示已讀：{n.subject}
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <button
              disabled={p.offset === 0 || p.busy}
              onClick={() => p.page(Math.max(0, p.offset - 20))}
            >
              上一頁通知
            </button>{" "}
            <button
              disabled={p.feed?.nextOffset == null || p.busy}
              onClick={() => p.page(p.feed!.nextOffset!)}
            >
              下一頁通知
            </button>
          </section>
          {(p.canExport || p.canPreview) && (
            <section>
              <h2>近期密碼驗證</h2>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void p.reauthenticate(password);
                  setPassword("");
                }}
              >
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
            </section>
          )}
          {p.canRead && (
            <section aria-labelledby="stats-heading">
              <h2 id="stats-heading">統計</h2>
              <p>以查詢當下資料為準；訂單金額為最小貨幣單位，並非收款總額。</p>
              {p.stats && (
                <>
                  <Counts title="報名" rows={p.stats.registrations} />
                  <Counts title="投稿" rows={p.stats.submissions} />
                  <Counts title="審查指派" rows={p.stats.reviews} />
                  <h3>訂單</h3>
                  <table>
                    <thead>
                      <tr>
                        <th>狀態</th>
                        <th>幣別</th>
                        <th>筆數</th>
                        <th>金額（最小貨幣單位）</th>
                      </tr>
                    </thead>
                    <tbody>
                      {p.stats.orders.map((r) => (
                        <tr key={r.state + r.currency}>
                          <td>{r.state}</td>
                          <td>{r.currency}</td>
                          <td>{r.count}</td>
                          <td>{r.amount}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </section>
          )}
          {p.canExport && (
            <section aria-labelledby="export-heading">
              <h2 id="export-heading">資料與 Email 清單匯出</h2>
              <p>
                每頁最多100筆。各頁獨立讀取；匯出期間異動可能影響分頁，請在活動較少時完整匯出。下載需近期密碼驗證，並留下稽核紀錄。
              </p>
              <label>
                匯出資料
                <select
                  value={kind}
                  onChange={(e) => setKind(e.target.value as typeof kind)}
                >
                  <option value="registrations">報名資料</option>
                  <option value="submissions">投稿摘要</option>
                  <option value="emails">已驗證且啟用的帳號 Email</option>
                </select>
              </label>{" "}
              <button
                disabled={p.busy}
                onClick={() => void p.exportPage(kind, 0)}
              >
                產生第一頁 CSV
              </button>
              {p.exported && (
                <div>
                  <p>本頁 {p.exported.rows} 筆</p>
                  <a
                    download={p.exported.filename}
                    href={`data:text/csv;charset=utf-8,${encodeURIComponent(p.exported.csv)}`}
                  >
                    下載 {p.exported.filename}
                  </a>
                  {p.exported.nextOffset !== null && (
                    <button
                      disabled={p.busy}
                      onClick={() =>
                        void p.exportPage(p.exportKind, p.exported!.nextOffset!)
                      }
                    >
                      產生下一頁 CSV
                    </button>
                  )}
                </div>
              )}
            </section>
          )}
          {p.canPreview && (
            <section aria-labelledby="preview-heading">
              <h2 id="preview-heading">受控作者視角預覽</h2>
              <p>
                僅顯示指定作者的報名與投稿摘要、已發布結果，不變更目前管理員身分。需近期密碼驗證並記錄查閱原因。
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void p.previewAuthor(id, reason);
                }}
              >
                <label>
                  作者本地帳號 UUID
                  <input
                    required
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                  />
                </label>
                <label>
                  查閱原因
                  <input
                    required
                    minLength={3}
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </label>
                <button disabled={p.busy}>開啟唯讀預覽</button>
              </form>
              {p.preview && (
                <div className="border p-4">
                  <h3>唯讀預覽：{p.preview.email}</h3>
                  <p role="status">
                    目前仍以管理員帳號操作；此處沒有作者操作功能。
                  </p>
                  <button onClick={p.closePreview}>關閉預覽</button>
                  {p.preview.truncated && (
                    <p>資料超過每類100筆，這份預覽並非完整清單。</p>
                  )}
                  <h4>報名</h4>
                  <ul>
                    {p.preview.registrations.map((r) => (
                      <li key={r.id}>
                        #{r.number} {r.badgeName} · {r.state}
                      </li>
                    ))}
                  </ul>
                  <h4>投稿</h4>
                  <ul>
                    {p.preview.submissions.map((r) => (
                      <li key={r.id}>
                        #{r.number} {r.title} · {r.state} · v{r.version}
                      </li>
                    ))}
                  </ul>
                  <h4>已發布結果</h4>
                  <ul>
                    {p.preview.results.map((r) => (
                      <li key={r.submissionId}>
                        {r.outcome}
                        <p>{r.authorMessage}</p>
                        <ul>
                          {r.authorComments.map((c, i) => (
                            <li key={i}>{c}</li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
function Counts({
  title,
  rows,
}: {
  title: string;
  rows: { state: string; count: number }[];
}) {
  return (
    <>
      <h3>{title}</h3>
      <ul>
        {rows.map((r) => (
          <li key={r.state}>
            {r.state}：{r.count}
          </li>
        ))}
      </ul>
    </>
  );
}
